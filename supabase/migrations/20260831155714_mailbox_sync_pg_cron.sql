-- Hosted mailbox sync scheduler: pg_cron + pg_net invoke mailbox-sync Edge Function.
-- Cadence for each mailbox remains sync_interval_minutes (SQL due-list).
-- Auth: vault secret `mailbox_sync_secret` sent as x-mailbox-sync-secret; Edge verifies
-- via public.verify_mailbox_sync_secret (service_role). Env MAILBOX_SYNC_SECRET still works.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- Shared cron header secret (Edge + pg_net). Regenerated only when missing.
do $$
begin
  if not exists (
    select 1 from vault.secrets where name = 'mailbox_sync_secret'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'mailbox_sync_secret',
      'Header secret for mailbox-sync Edge cron (x-mailbox-sync-secret)'
    );
  end if;
end;
$$;

create or replace function public.verify_mailbox_sync_secret(p_supplied text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  expected text;
begin
  if p_supplied is null or length(trim(p_supplied)) = 0 then
    return false;
  end if;

  select decrypted_secret
  into expected
  from vault.decrypted_secrets
  where name = 'mailbox_sync_secret'
  limit 1;

  if expected is null or length(expected) = 0 then
    return false;
  end if;

  return expected = trim(p_supplied);
end;
$$;

revoke all on function public.verify_mailbox_sync_secret(text)
  from public, anon, authenticated;
grant execute on function public.verify_mailbox_sync_secret(text)
  to service_role;

create or replace function private.invoke_mailbox_sync_from_cron()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_url text;
  sync_secret text;
  request_id bigint;
begin
  select decrypted_secret
  into project_url
  from vault.decrypted_secrets
  where name = 'project_url'
  limit 1;

  select decrypted_secret
  into sync_secret
  from vault.decrypted_secrets
  where name = 'mailbox_sync_secret'
  limit 1;

  if project_url is null or length(trim(project_url)) = 0
     or sync_secret is null or length(trim(sync_secret)) = 0 then
    raise warning
      'mailbox sync cron skipped: vault secrets project_url and/or mailbox_sync_secret missing';
    return null;
  end if;

  select net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/mailbox-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-mailbox-sync-secret', sync_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  )
  into request_id;

  return request_id;
end;
$$;

revoke all on function private.invoke_mailbox_sync_from_cron()
  from public, anon, authenticated;

-- Every minute; list_mailboxes_due_for_sync enforces per-mailbox intervals.
do $$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'mailbox-sync-every-minute';

  perform cron.schedule(
    'mailbox-sync-every-minute',
    '* * * * *',
    $cron$select private.invoke_mailbox_sync_from_cron();$cron$
  );
end;
$$;

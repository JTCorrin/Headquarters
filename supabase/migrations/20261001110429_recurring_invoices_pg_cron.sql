-- Hosted recurring invoices scheduler: pg_cron + pg_net invoke jobs-recurring-invoices.
-- Auth: vault secret `recurring_invoices_cron_secret` sent as x-recurring-invoices-cron-secret;
-- Edge verifies via public.verify_recurring_invoices_cron_secret (service_role).
-- Env RECURRING_INVOICES_CRON_SECRET still works for self-hosted/staging wrappers.
-- Requires pg_cron / pg_net (already enabled by mailbox_sync_pg_cron migration).

-- Shared cron header secret (Edge + pg_net). Regenerated only when missing.
do $$
begin
  if not exists (
    select 1 from vault.secrets where name = 'recurring_invoices_cron_secret'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'recurring_invoices_cron_secret',
      'Header secret for jobs-recurring-invoices Edge cron (x-recurring-invoices-cron-secret)'
    );
  end if;
end;
$$;

create or replace function public.verify_recurring_invoices_cron_secret(p_supplied text)
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
  where name = 'recurring_invoices_cron_secret'
  limit 1;

  if expected is null or length(expected) = 0 then
    return false;
  end if;

  return expected = trim(p_supplied);
end;
$$;

revoke all on function public.verify_recurring_invoices_cron_secret(text)
  from public, anon, authenticated;
grant execute on function public.verify_recurring_invoices_cron_secret(text)
  to service_role;

create or replace function private.invoke_recurring_invoices_from_cron()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_url text;
  cron_secret text;
  request_id bigint;
begin
  select decrypted_secret
  into project_url
  from vault.decrypted_secrets
  where name = 'project_url'
  limit 1;

  select decrypted_secret
  into cron_secret
  from vault.decrypted_secrets
  where name = 'recurring_invoices_cron_secret'
  limit 1;

  if project_url is null or length(trim(project_url)) = 0
     or cron_secret is null or length(trim(cron_secret)) = 0 then
    raise warning
      'recurring invoices cron skipped: vault secrets project_url and/or recurring_invoices_cron_secret missing';
    return null;
  end if;

  select net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/jobs-recurring-invoices',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-recurring-invoices-cron-secret', cron_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  )
  into request_id;

  return request_id;
end;
$$;

revoke all on function private.invoke_recurring_invoices_from_cron()
  from public, anon, authenticated;

-- Every 5 minutes; process_due_recurring_schedules claims due active schedules.
do $$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'recurring-invoices-every-5m';

  perform cron.schedule(
    'recurring-invoices-every-5m',
    '*/5 * * * *',
    $cron$select private.invoke_recurring_invoices_from_cron();$cron$
  );
end;
$$;

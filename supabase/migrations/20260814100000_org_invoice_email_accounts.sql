-- Org-level invoice SMTP config (owner-managed) for recurring auto-send.
-- Secrets live in private.integration_secrets via secret_ref — never granted to clients.

set search_path = public, extensions, pg_catalog;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.org_invoice_email_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  from_address extensions.citext not null,
  from_name text,
  reply_to extensions.citext,
  smtp_host text not null,
  smtp_port integer not null check (smtp_port between 1 and 65535),
  smtp_security text not null default 'tls'
    check (smtp_security in ('tls', 'starttls', 'none')),
  username text not null,
  secret_ref uuid,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'error', 'disabled')),
  subject_template text not null default 'Invoice {{invoice_number}} from {{org_name}}',
  body_template text not null default
    E'Hello,\n\nPlease find attached invoice {{invoice_number}} for {{client_name}}.\n\nTotal due: {{total}}\nDue date: {{due_on}}\n\nThank you.',
  last_tested_at timestamptz,
  last_error_code text,
  last_error_message text,
  credentials_updated_at timestamptz,
  constraint org_invoice_email_accounts_org_id_id_key unique (org_id, id),
  constraint org_invoice_email_accounts_from_address_check
    check (char_length(from_address::text) between 3 and 320),
  constraint org_invoice_email_accounts_smtp_host_check
    check (char_length(trim(smtp_host)) between 1 and 255),
  constraint org_invoice_email_accounts_username_check
    check (char_length(trim(username)) between 1 and 320),
  constraint org_invoice_email_accounts_subject_template_check
    check (char_length(subject_template) between 1 and 500),
  constraint org_invoice_email_accounts_body_template_check
    check (char_length(body_template) between 1 and 10000)
);

create unique index org_invoice_email_accounts_org_active_uidx
  on public.org_invoice_email_accounts (org_id)
  where deleted_at is null;

create trigger org_invoice_email_accounts_set_updated_at
before update on public.org_invoice_email_accounts
for each row
execute function private.set_updated_at();

alter table public.org_invoice_email_accounts enable row level security;

create policy org_invoice_email_accounts_select_member
on public.org_invoice_email_accounts
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(org_id, array['owner', 'admin', 'member', 'readonly'])
);

revoke all on table public.org_invoice_email_accounts from public, anon, authenticated;
grant select (
  id, org_id, created_at, updated_at, created_by, updated_by, deleted_at, version,
  from_address, from_name, reply_to, smtp_host, smtp_port, smtp_security, username,
  status, subject_template, body_template, last_tested_at, last_error_code,
  last_error_message, credentials_updated_at
) on table public.org_invoice_email_accounts to authenticated;
-- secret_ref intentionally not granted

-- ---------------------------------------------------------------------------
-- Public JSON helper
-- ---------------------------------------------------------------------------

create or replace function private.org_invoice_email_account_public_json(
  p_row public.org_invoice_email_accounts
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_row.id,
    'org_id', p_row.org_id,
    'from_address', p_row.from_address,
    'from_name', p_row.from_name,
    'reply_to', p_row.reply_to,
    'smtp_host', p_row.smtp_host,
    'smtp_port', p_row.smtp_port,
    'smtp_security', p_row.smtp_security,
    'username', p_row.username,
    'status', p_row.status,
    'subject_template', p_row.subject_template,
    'body_template', p_row.body_template,
    'last_tested_at', p_row.last_tested_at,
    'last_error_code', p_row.last_error_code,
    'last_error_message', p_row.last_error_message,
    'credentials_configured', (p_row.secret_ref is not null),
    'credentials_updated_at', p_row.credentials_updated_at,
    'version', p_row.version,
    'created_at', p_row.created_at,
    'updated_at', p_row.updated_at
  );
$$;

revoke all on function private.org_invoice_email_account_public_json(
  public.org_invoice_email_accounts
) from public, anon, authenticated;

create or replace function public.org_invoice_email_is_configured(p_org_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_org_id is null then
    return false;
  end if;
  if not private.has_org_role(
    p_org_id, array['owner', 'admin', 'member', 'readonly', 'billing']
  ) then
    -- Allow service_role (no JWT) to check for cron guards.
    if auth.uid() is not null then
      raise exception 'Forbidden' using errcode = '42501';
    end if;
  end if;

  return exists (
    select 1
    from public.org_invoice_email_accounts a
    where a.org_id = p_org_id
      and a.deleted_at is null
      and a.secret_ref is not null
      and a.status = 'active'
  );
end;
$$;

revoke all on function public.org_invoice_email_is_configured(uuid) from public, anon;
grant execute on function public.org_invoice_email_is_configured(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- CRUD RPCs (owner mutate)
-- ---------------------------------------------------------------------------

create or replace function public.get_org_invoice_email_account(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  existing public.org_invoice_email_accounts;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not private.has_org_role(
    p_org_id, array['owner', 'admin', 'member', 'readonly']
  ) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select * into existing
  from public.org_invoice_email_accounts
  where org_id = p_org_id
    and deleted_at is null;

  if existing.id is null then
    return null;
  end if;

  return private.org_invoice_email_account_public_json(existing);
end;
$$;

revoke all on function public.get_org_invoice_email_account(uuid) from public, anon;
grant execute on function public.get_org_invoice_email_account(uuid) to authenticated;

create or replace function public.upsert_org_invoice_email_account(
  p_org_id uuid,
  p_from_address text,
  p_from_name text,
  p_reply_to text,
  p_smtp_host text,
  p_smtp_port integer,
  p_smtp_security text,
  p_username text,
  p_password text default null,
  p_subject_template text default null,
  p_body_template text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  existing public.org_invoice_email_accounts;
  result_row public.org_invoice_email_accounts;
  new_secret uuid;
  old_secret uuid;
  v_from text;
  v_from_name text;
  v_reply text;
  v_host text;
  v_security text;
  v_username text;
  v_subject text;
  v_body text;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not private.has_org_role(p_org_id, array['owner']) then
    raise exception 'Only owners can manage invoice email' using errcode = '42501';
  end if;

  v_from := lower(trim(coalesce(p_from_address, '')));
  if v_from !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_from) > 320 then
    raise exception 'from_address is invalid' using errcode = '22023';
  end if;

  v_from_name := nullif(trim(coalesce(p_from_name, '')), '');
  if v_from_name is not null and char_length(v_from_name) > 120 then
    raise exception 'from_name is too long' using errcode = '22023';
  end if;

  v_reply := nullif(lower(trim(coalesce(p_reply_to, ''))), '');
  if v_reply is not null then
    if v_reply !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_reply) > 320 then
      raise exception 'reply_to is invalid' using errcode = '22023';
    end if;
  end if;

  v_host := trim(coalesce(p_smtp_host, ''));
  if char_length(v_host) < 1 or char_length(v_host) > 255 then
    raise exception 'smtp_host is required' using errcode = '22023';
  end if;

  if p_smtp_port is null or p_smtp_port < 1 or p_smtp_port > 65535 then
    raise exception 'smtp_port is invalid' using errcode = '22023';
  end if;

  v_security := lower(trim(coalesce(p_smtp_security, 'tls')));
  if v_security not in ('tls', 'starttls', 'none') then
    raise exception 'smtp_security is invalid' using errcode = '22023';
  end if;

  v_username := trim(coalesce(p_username, ''));
  if char_length(v_username) < 1 or char_length(v_username) > 320 then
    raise exception 'username is required' using errcode = '22023';
  end if;

  v_subject := coalesce(
    nullif(trim(p_subject_template), ''),
    'Invoice {{invoice_number}} from {{org_name}}'
  );
  if char_length(v_subject) > 500 then
    raise exception 'subject_template is too long' using errcode = '22023';
  end if;

  v_body := coalesce(
    nullif(p_body_template, ''),
    E'Hello,\n\nPlease find attached invoice {{invoice_number}} for {{client_name}}.\n\nTotal due: {{total}}\nDue date: {{due_on}}\n\nThank you.'
  );
  if char_length(v_body) > 10000 then
    raise exception 'body_template is too long' using errcode = '22023';
  end if;

  select * into existing
  from public.org_invoice_email_accounts
  where org_id = p_org_id
    and deleted_at is null
  for update;

  if existing.id is null then
    if p_password is null or char_length(p_password) < 1 then
      raise exception 'password is required when connecting invoice email'
        using errcode = '22023';
    end if;
    if char_length(p_password) > 512 then
      raise exception 'password is too long' using errcode = '22023';
    end if;

    new_secret := private.store_secret(p_password);

    insert into public.org_invoice_email_accounts (
      org_id, created_by, updated_by,
      from_address, from_name, reply_to,
      smtp_host, smtp_port, smtp_security, username, secret_ref,
      status, subject_template, body_template, credentials_updated_at
    ) values (
      p_org_id, actor_id, actor_id,
      v_from, v_from_name, v_reply,
      v_host, p_smtp_port, v_security, v_username, new_secret,
      'active', v_subject, v_body, now()
    )
    returning * into result_row;
  else
    old_secret := existing.secret_ref;
    if p_password is not null and char_length(p_password) > 0 then
      if char_length(p_password) > 512 then
        raise exception 'password is too long' using errcode = '22023';
      end if;
      new_secret := private.store_secret(p_password);
    else
      if old_secret is null then
        raise exception 'password is required when credentials are missing'
          using errcode = '22023';
      end if;
      new_secret := old_secret;
    end if;

    update public.org_invoice_email_accounts
    set
      from_address = v_from,
      from_name = v_from_name,
      reply_to = v_reply,
      smtp_host = v_host,
      smtp_port = p_smtp_port,
      smtp_security = v_security,
      username = v_username,
      secret_ref = new_secret,
      status = 'active',
      subject_template = v_subject,
      body_template = v_body,
      last_error_code = null,
      last_error_message = null,
      credentials_updated_at = case
        when new_secret is distinct from old_secret then now()
        else credentials_updated_at
      end,
      updated_by = actor_id,
      version = version + 1
    where id = existing.id
    returning * into result_row;

    if old_secret is not null and new_secret is distinct from old_secret then
      perform private.delete_secret(old_secret);
    end if;
  end if;

  return private.org_invoice_email_account_public_json(result_row);
end;
$$;

revoke all on function public.upsert_org_invoice_email_account(
  uuid, text, text, text, text, integer, text, text, text, text, text
) from public, anon;
grant execute on function public.upsert_org_invoice_email_account(
  uuid, text, text, text, text, integer, text, text, text, text, text
) to authenticated;

create or replace function public.disconnect_org_invoice_email_account(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  existing public.org_invoice_email_accounts;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not private.has_org_role(p_org_id, array['owner']) then
    raise exception 'Only owners can manage invoice email' using errcode = '42501';
  end if;

  select * into existing
  from public.org_invoice_email_accounts
  where org_id = p_org_id
    and deleted_at is null
  for update;

  if existing.id is null then
    return;
  end if;

  update public.org_invoice_email_accounts
  set
    deleted_at = now(),
    secret_ref = null,
    status = 'disabled',
    updated_by = actor_id,
    version = version + 1
  where id = existing.id;

  if existing.secret_ref is not null then
    perform private.delete_secret(existing.secret_ref);
  end if;
end;
$$;

revoke all on function public.disconnect_org_invoice_email_account(uuid) from public, anon;
grant execute on function public.disconnect_org_invoice_email_account(uuid) to authenticated;

create or replace function public.mark_org_invoice_email_test_result(
  p_org_id uuid,
  p_ok boolean,
  p_error_code text default null,
  p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  existing public.org_invoice_email_accounts;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not private.has_org_role(p_org_id, array['owner']) then
    raise exception 'Only owners can manage invoice email' using errcode = '42501';
  end if;

  select * into existing
  from public.org_invoice_email_accounts
  where org_id = p_org_id
    and deleted_at is null
  for update;

  if existing.id is null then
    raise exception 'Invoice email is not configured' using errcode = 'P0002';
  end if;

  update public.org_invoice_email_accounts
  set
    last_tested_at = now(),
    last_error_code = case when p_ok then null else left(coalesce(p_error_code, 'test_failed'), 120) end,
    last_error_message = case when p_ok then null else left(coalesce(p_error_message, 'Test failed'), 500) end,
    status = case when p_ok then 'active' else 'error' end,
    updated_by = actor_id,
    version = version + 1
  where id = existing.id
  returning * into existing;

  return private.org_invoice_email_account_public_json(existing);
end;
$$;

revoke all on function public.mark_org_invoice_email_test_result(
  uuid, boolean, text, text
) from public, anon;
grant execute on function public.mark_org_invoice_email_test_result(
  uuid, boolean, text, text
) to authenticated;

-- Service-role credential read for Edge document send / SMTP test
create or replace function public.read_org_invoice_email_credentials(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.org_invoice_email_accounts;
  password text;
begin
  select * into existing
  from public.org_invoice_email_accounts
  where org_id = p_org_id
    and deleted_at is null;

  if existing.id is null then
    return null;
  end if;

  if existing.secret_ref is not null then
    password := private.read_secret(existing.secret_ref);
  end if;

  return jsonb_build_object(
    'id', existing.id,
    'from_address', existing.from_address,
    'from_name', existing.from_name,
    'reply_to', existing.reply_to,
    'smtp_host', existing.smtp_host,
    'smtp_port', existing.smtp_port,
    'smtp_security', existing.smtp_security,
    'username', existing.username,
    'password', password,
    'status', existing.status,
    'subject_template', existing.subject_template,
    'body_template', existing.body_template
  );
end;
$$;

revoke all on function public.read_org_invoice_email_credentials(uuid)
  from public, anon, authenticated;
grant execute on function public.read_org_invoice_email_credentials(uuid)
  to service_role;

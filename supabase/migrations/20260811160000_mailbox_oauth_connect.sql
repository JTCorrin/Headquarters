-- Mailbox OAuth (Microsoft + Google): auth_mode, oauth state, token upsert, credential read.

-- ---------------------------------------------------------------------------
-- mailbox_accounts: auth_mode + oauth_provider
-- ---------------------------------------------------------------------------

alter table public.mailbox_accounts
  add column if not exists auth_mode text not null default 'password'
    check (auth_mode in ('password', 'oauth')),
  add column if not exists oauth_provider text
    check (
      oauth_provider is null
      or oauth_provider in ('microsoft', 'google')
    );

alter table public.mailbox_accounts
  drop constraint if exists mailbox_accounts_oauth_provider_mode_check;

alter table public.mailbox_accounts
  add constraint mailbox_accounts_oauth_provider_mode_check
  check (
    (auth_mode = 'password' and oauth_provider is null)
    or (auth_mode = 'oauth' and oauth_provider is not null)
  );

grant select (
  id, org_id, created_at, updated_at, created_by, updated_by, deleted_at, version,
  membership_id, email_address, from_name,
  imap_host, imap_port, imap_security,
  smtp_host, smtp_port, smtp_security,
  username, status, last_checked_at, last_error_code, credentials_updated_at,
  sync_lookback_days, sync_max_messages, sync_max_body_bytes,
  sync_attachments_metadata_only, sync_lease_until, sync_lease_holder,
  consecutive_auth_failures, auth_mode, oauth_provider
) on table public.mailbox_accounts to authenticated;

-- ---------------------------------------------------------------------------
-- OAuth CSRF state (private)
-- ---------------------------------------------------------------------------

create table private.mailbox_oauth_states (
  state text primary key,
  org_id uuid not null references public.organisations (id) on delete cascade,
  membership_id uuid not null,
  provider text not null
    check (provider in ('microsoft', 'google')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint mailbox_oauth_states_membership_fk
    foreign key (org_id, membership_id)
    references public.memberships (org_id, id)
    on delete cascade
);

revoke all on table private.mailbox_oauth_states from public, anon, authenticated;

create index mailbox_oauth_states_expires_idx
  on private.mailbox_oauth_states (expires_at);

-- ---------------------------------------------------------------------------
-- Public JSON envelope helper
-- ---------------------------------------------------------------------------

create or replace function private.mailbox_account_public_json(
  p_row public.mailbox_accounts
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_row.id,
    'org_id', p_row.org_id,
    'membership_id', p_row.membership_id,
    'email_address', p_row.email_address,
    'from_name', p_row.from_name,
    'imap_host', p_row.imap_host,
    'imap_port', p_row.imap_port,
    'imap_security', p_row.imap_security,
    'smtp_host', p_row.smtp_host,
    'smtp_port', p_row.smtp_port,
    'smtp_security', p_row.smtp_security,
    'username', p_row.username,
    'status', p_row.status,
    'auth_mode', p_row.auth_mode,
    'oauth_provider', p_row.oauth_provider,
    'last_checked_at', p_row.last_checked_at,
    'last_error_code', p_row.last_error_code,
    'credentials_configured', (p_row.secret_ref is not null),
    'credentials_updated_at', p_row.credentials_updated_at,
    'version', p_row.version,
    'created_at', p_row.created_at,
    'updated_at', p_row.updated_at
  );
$$;

revoke all on function private.mailbox_account_public_json(public.mailbox_accounts)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- OAuth state RPCs
-- ---------------------------------------------------------------------------

create or replace function public.create_mailbox_oauth_state(
  p_org_id uuid,
  p_state text,
  p_provider text,
  p_ttl_seconds integer default 600
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  membership_row public.memberships;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if p_state is null or char_length(trim(p_state)) < 16 then
    raise exception 'Invalid OAuth state'
      using errcode = '22023';
  end if;

  if p_provider is null or p_provider not in ('microsoft', 'google') then
    raise exception 'Invalid OAuth provider'
      using errcode = '22023';
  end if;

  if not private.has_org_role(
    p_org_id,
    array['owner', 'admin', 'member']
  ) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  select * into membership_row
  from public.memberships
  where memberships.org_id = p_org_id
    and memberships.user_id = actor_id
    and memberships.status = 'active';

  if membership_row.id is null or membership_row.role in ('billing', 'readonly') then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  delete from private.mailbox_oauth_states
  where expires_at < now()
     or (org_id = p_org_id and membership_id = membership_row.id);

  insert into private.mailbox_oauth_states (
    state, org_id, membership_id, provider, expires_at
  )
  values (
    trim(p_state),
    p_org_id,
    membership_row.id,
    p_provider,
    now() + make_interval(secs => greatest(coalesce(p_ttl_seconds, 600), 60))
  );
end;
$$;

revoke all on function public.create_mailbox_oauth_state(uuid, text, text, integer)
  from public, anon;
grant execute on function public.create_mailbox_oauth_state(uuid, text, text, integer)
  to authenticated;

create or replace function public.consume_mailbox_oauth_state(
  p_org_id uuid,
  p_state text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  membership_row public.memberships;
  state_row private.mailbox_oauth_states;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  select * into membership_row
  from public.memberships
  where memberships.org_id = p_org_id
    and memberships.user_id = actor_id
    and memberships.status = 'active';

  if membership_row.id is null then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  select * into state_row
  from private.mailbox_oauth_states
  where mailbox_oauth_states.state = trim(p_state)
  for update;

  if state_row.state is null then
    raise exception 'OAuth state not found'
      using errcode = 'P0002';
  end if;

  if state_row.expires_at < now() then
    delete from private.mailbox_oauth_states where state = state_row.state;
    raise exception 'OAuth state expired'
      using errcode = 'P0001';
  end if;

  if state_row.org_id is distinct from p_org_id
     or state_row.membership_id is distinct from membership_row.id then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  delete from private.mailbox_oauth_states where state = state_row.state;

  return jsonb_build_object(
    'org_id', state_row.org_id,
    'membership_id', state_row.membership_id,
    'provider', state_row.provider
  );
end;
$$;

revoke all on function public.consume_mailbox_oauth_state(uuid, text)
  from public, anon;
grant execute on function public.consume_mailbox_oauth_state(uuid, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Upsert mailbox via OAuth token blob
-- ---------------------------------------------------------------------------

create or replace function public.upsert_mailbox_account_oauth(
  p_org_id uuid,
  p_provider text,
  p_token_blob text,
  p_email_address text,
  p_from_name text default null,
  p_imap_host text default null,
  p_imap_port integer default null,
  p_imap_security text default null,
  p_smtp_host text default null,
  p_smtp_port integer default null,
  p_smtp_security text default null,
  p_username text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  membership_row public.memberships;
  existing public.mailbox_accounts;
  new_secret uuid;
  old_secret uuid;
  result_row public.mailbox_accounts;
  v_email text;
  v_username text;
  v_imap_host text;
  v_imap_port integer;
  v_imap_security text;
  v_smtp_host text;
  v_smtp_port integer;
  v_smtp_security text;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if p_provider is null or p_provider not in ('microsoft', 'google') then
    raise exception 'Invalid OAuth provider'
      using errcode = '22023';
  end if;

  if p_token_blob is null or char_length(trim(p_token_blob)) < 8 then
    raise exception 'OAuth token blob is required'
      using errcode = '22023';
  end if;

  v_email := lower(trim(coalesce(p_email_address, '')));
  if char_length(v_email) < 3 or position('@' in v_email) = 0 then
    raise exception 'Valid email address is required'
      using errcode = '22023';
  end if;

  if not private.has_org_role(
    p_org_id,
    array['owner', 'admin', 'member']
  ) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  select * into membership_row
  from public.memberships
  where memberships.org_id = p_org_id
    and memberships.user_id = actor_id
    and memberships.status = 'active';

  if membership_row.id is null or membership_row.role in ('billing', 'readonly') then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  if p_provider = 'microsoft' then
    v_imap_host := coalesce(nullif(trim(p_imap_host), ''), 'outlook.office365.com');
    v_imap_port := coalesce(p_imap_port, 993);
    v_imap_security := coalesce(nullif(trim(p_imap_security), ''), 'tls');
    v_smtp_host := coalesce(nullif(trim(p_smtp_host), ''), 'smtp-mail.outlook.com');
    v_smtp_port := coalesce(p_smtp_port, 587);
    v_smtp_security := coalesce(nullif(trim(p_smtp_security), ''), 'starttls');
  else
    v_imap_host := coalesce(nullif(trim(p_imap_host), ''), 'imap.gmail.com');
    v_imap_port := coalesce(p_imap_port, 993);
    v_imap_security := coalesce(nullif(trim(p_imap_security), ''), 'tls');
    v_smtp_host := coalesce(nullif(trim(p_smtp_host), ''), 'smtp.gmail.com');
    v_smtp_port := coalesce(p_smtp_port, 465);
    v_smtp_security := coalesce(nullif(trim(p_smtp_security), ''), 'tls');
  end if;

  v_username := coalesce(nullif(trim(p_username), ''), v_email);

  select * into existing
  from public.mailbox_accounts
  where mailbox_accounts.org_id = p_org_id
    and mailbox_accounts.membership_id = membership_row.id
    and mailbox_accounts.deleted_at is null
  for update;

  new_secret := private.store_secret(trim(p_token_blob));

  if existing.id is null then
    insert into public.mailbox_accounts (
      org_id,
      membership_id,
      email_address,
      from_name,
      imap_host,
      imap_port,
      imap_security,
      smtp_host,
      smtp_port,
      smtp_security,
      username,
      secret_ref,
      auth_mode,
      oauth_provider,
      status,
      credentials_updated_at,
      created_by,
      updated_by
    )
    values (
      p_org_id,
      membership_row.id,
      v_email,
      nullif(trim(coalesce(p_from_name, '')), ''),
      v_imap_host,
      v_imap_port,
      v_imap_security,
      v_smtp_host,
      v_smtp_port,
      v_smtp_security,
      v_username,
      new_secret,
      'oauth',
      p_provider,
      'active',
      now(),
      actor_id,
      actor_id
    )
    returning * into result_row;
  else
    old_secret := existing.secret_ref;
    update public.mailbox_accounts
    set
      email_address = v_email,
      from_name = coalesce(
        nullif(trim(coalesce(p_from_name, '')), ''),
        existing.from_name
      ),
      imap_host = v_imap_host,
      imap_port = v_imap_port,
      imap_security = v_imap_security,
      smtp_host = v_smtp_host,
      smtp_port = v_smtp_port,
      smtp_security = v_smtp_security,
      username = v_username,
      secret_ref = new_secret,
      auth_mode = 'oauth',
      oauth_provider = p_provider,
      status = 'active',
      last_error_code = null,
      consecutive_auth_failures = 0,
      credentials_updated_at = now(),
      updated_by = actor_id,
      version = existing.version + 1
    where mailbox_accounts.id = existing.id
    returning * into result_row;

    if old_secret is not null and old_secret is distinct from new_secret then
      perform private.delete_secret(old_secret);
    end if;
  end if;

  return private.mailbox_account_public_json(result_row);
end;
$$;

revoke all on function public.upsert_mailbox_account_oauth(
  uuid, text, text, text, text, text, integer, text, text, integer, text, text
) from public, anon;
grant execute on function public.upsert_mailbox_account_oauth(
  uuid, text, text, text, text, text, integer, text, text, integer, text, text
) to authenticated;

-- Service-role token refresh (no membership check — Edge only)
create or replace function public.update_mailbox_oauth_token_blob(
  p_mailbox_id uuid,
  p_token_blob text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  mailbox public.mailbox_accounts;
  new_secret uuid;
  old_secret uuid;
begin
  if p_token_blob is null or char_length(trim(p_token_blob)) < 8 then
    raise exception 'OAuth token blob is required'
      using errcode = '22023';
  end if;

  select * into mailbox
  from public.mailbox_accounts
  where mailbox_accounts.id = p_mailbox_id
    and mailbox_accounts.deleted_at is null
  for update;

  if mailbox.id is null then
    raise exception 'Mailbox not found'
      using errcode = 'P0002';
  end if;

  if mailbox.auth_mode is distinct from 'oauth' then
    raise exception 'Mailbox is not OAuth-authenticated'
      using errcode = '22023';
  end if;

  old_secret := mailbox.secret_ref;
  new_secret := private.store_secret(trim(p_token_blob));

  update public.mailbox_accounts
  set
    secret_ref = new_secret,
    credentials_updated_at = now(),
    version = mailbox.version + 1
  where mailbox_accounts.id = mailbox.id;

  if old_secret is not null and old_secret is distinct from new_secret then
    perform private.delete_secret(old_secret);
  end if;
end;
$$;

revoke all on function public.update_mailbox_oauth_token_blob(uuid, text)
  from public, anon, authenticated;
grant execute on function public.update_mailbox_oauth_token_blob(uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Password upsert: force auth_mode=password; public JSON includes OAuth fields
-- ---------------------------------------------------------------------------

create or replace function public.upsert_mailbox_account(
  p_org_id uuid,
  p_email_address text,
  p_from_name text,
  p_imap_host text,
  p_imap_port integer,
  p_imap_security text,
  p_smtp_host text,
  p_smtp_port integer,
  p_smtp_security text,
  p_username text,
  p_password text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  membership_row public.memberships;
  existing public.mailbox_accounts;
  new_secret uuid;
  old_secret uuid;
  result_row public.mailbox_accounts;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(
    p_org_id,
    array['owner', 'admin', 'member']
  ) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  select * into membership_row
  from public.memberships
  where memberships.org_id = p_org_id
    and memberships.user_id = actor_id
    and memberships.status = 'active';

  if membership_row.id is null then
    raise exception 'No active membership'
      using errcode = '42501';
  end if;

  if membership_row.role = 'billing' or membership_row.role = 'readonly' then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  select * into existing
  from public.mailbox_accounts
  where mailbox_accounts.org_id = p_org_id
    and mailbox_accounts.membership_id = membership_row.id
    and mailbox_accounts.deleted_at is null
  for update;

  if existing.id is null and (p_password is null or length(p_password) = 0) then
    raise exception 'Password is required when creating a mailbox'
      using errcode = '22023';
  end if;

  -- Switching to password auth always stores a password (or keeps existing password secret).
  if existing.id is not null
     and existing.auth_mode = 'oauth'
     and (p_password is null or length(p_password) = 0) then
    raise exception 'Password is required when switching from OAuth to password auth'
      using errcode = '22023';
  end if;

  if p_password is not null and length(p_password) > 0 then
    new_secret := private.store_secret(p_password);
  else
    new_secret := existing.secret_ref;
  end if;

  if existing.id is null then
    insert into public.mailbox_accounts (
      org_id,
      membership_id,
      email_address,
      from_name,
      imap_host,
      imap_port,
      imap_security,
      smtp_host,
      smtp_port,
      smtp_security,
      username,
      secret_ref,
      auth_mode,
      oauth_provider,
      status,
      credentials_updated_at,
      created_by,
      updated_by
    )
    values (
      p_org_id,
      membership_row.id,
      lower(trim(p_email_address)),
      nullif(trim(p_from_name), ''),
      trim(p_imap_host),
      p_imap_port,
      p_imap_security,
      trim(p_smtp_host),
      p_smtp_port,
      p_smtp_security,
      trim(p_username),
      new_secret,
      'password',
      null,
      'active',
      case when p_password is not null and length(p_password) > 0 then now() else null end,
      actor_id,
      actor_id
    )
    returning * into result_row;
  else
    old_secret := existing.secret_ref;
    update public.mailbox_accounts
    set
      email_address = lower(trim(p_email_address)),
      from_name = nullif(trim(p_from_name), ''),
      imap_host = trim(p_imap_host),
      imap_port = p_imap_port,
      imap_security = p_imap_security,
      smtp_host = trim(p_smtp_host),
      smtp_port = p_smtp_port,
      smtp_security = p_smtp_security,
      username = trim(p_username),
      secret_ref = new_secret,
      auth_mode = 'password',
      oauth_provider = null,
      status = 'active',
      last_error_code = null,
      consecutive_auth_failures = 0,
      credentials_updated_at = case
        when p_password is not null and length(p_password) > 0 then now()
        else existing.credentials_updated_at
      end,
      updated_by = actor_id,
      version = existing.version + 1
    where mailbox_accounts.id = existing.id
    returning * into result_row;

    if p_password is not null and length(p_password) > 0
       and old_secret is not null
       and old_secret is distinct from new_secret then
      perform private.delete_secret(old_secret);
    end if;
  end if;

  return private.mailbox_account_public_json(result_row);
end;
$$;

create or replace function public.get_mailbox_account(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  membership_row public.memberships;
  existing public.mailbox_accounts;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(
    p_org_id,
    array['owner', 'admin', 'member', 'readonly']
  ) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  select * into membership_row
  from public.memberships
  where memberships.org_id = p_org_id
    and memberships.user_id = actor_id
    and memberships.status = 'active';

  if membership_row.id is null then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  select * into existing
  from public.mailbox_accounts
  where mailbox_accounts.org_id = p_org_id
    and mailbox_accounts.membership_id = membership_row.id
    and mailbox_accounts.deleted_at is null;

  if existing.id is null then
    return null;
  end if;

  return private.mailbox_account_public_json(existing);
end;
$$;

-- ---------------------------------------------------------------------------
-- Credential read: password vs token_blob
-- ---------------------------------------------------------------------------

create or replace function public.read_mailbox_sync_credentials(p_mailbox_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  mailbox public.mailbox_accounts;
  secret_value text;
begin
  select * into mailbox
  from public.mailbox_accounts
  where mailbox_accounts.id = p_mailbox_id
    and mailbox_accounts.deleted_at is null;

  if mailbox.id is null then
    raise exception 'Mailbox not found'
      using errcode = 'P0002';
  end if;

  if mailbox.secret_ref is null then
    return jsonb_build_object(
      'auth_mode', mailbox.auth_mode,
      'oauth_provider', mailbox.oauth_provider,
      'password', null,
      'token_blob', null,
      'username', mailbox.username,
      'imap_host', mailbox.imap_host,
      'imap_port', mailbox.imap_port,
      'imap_security', mailbox.imap_security,
      'smtp_host', mailbox.smtp_host,
      'smtp_port', mailbox.smtp_port,
      'smtp_security', mailbox.smtp_security,
      'email_address', mailbox.email_address
    );
  end if;

  secret_value := private.read_secret(mailbox.secret_ref);

  if mailbox.auth_mode = 'oauth' then
    return jsonb_build_object(
      'auth_mode', 'oauth',
      'oauth_provider', mailbox.oauth_provider,
      'password', null,
      'token_blob', secret_value,
      'username', mailbox.username,
      'imap_host', mailbox.imap_host,
      'imap_port', mailbox.imap_port,
      'imap_security', mailbox.imap_security,
      'smtp_host', mailbox.smtp_host,
      'smtp_port', mailbox.smtp_port,
      'smtp_security', mailbox.smtp_security,
      'email_address', mailbox.email_address
    );
  end if;

  return jsonb_build_object(
    'auth_mode', 'password',
    'oauth_provider', null,
    'password', secret_value,
    'token_blob', null,
    'username', mailbox.username,
    'imap_host', mailbox.imap_host,
    'imap_port', mailbox.imap_port,
    'imap_security', mailbox.imap_security,
    'smtp_host', mailbox.smtp_host,
    'smtp_port', mailbox.smtp_port,
    'smtp_security', mailbox.smtp_security,
    'email_address', mailbox.email_address
  );
end;
$$;

revoke all on function public.read_mailbox_sync_credentials(uuid)
  from public, anon, authenticated;
grant execute on function public.read_mailbox_sync_credentials(uuid)
  to service_role;

-- Disconnect clears OAuth fields via soft-delete of the row (existing behaviour).
-- Ensure auth_mode reset on soft-delete for cleanliness.
create or replace function public.disconnect_mailbox_account(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  membership_row public.memberships;
  existing public.mailbox_accounts;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(
    p_org_id,
    array['owner', 'admin', 'member']
  ) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  select * into membership_row
  from public.memberships
  where memberships.org_id = p_org_id
    and memberships.user_id = actor_id
    and memberships.status = 'active';

  if membership_row.id is null or membership_row.role in ('billing', 'readonly') then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  select * into existing
  from public.mailbox_accounts
  where mailbox_accounts.org_id = p_org_id
    and mailbox_accounts.membership_id = membership_row.id
    and mailbox_accounts.deleted_at is null
  for update;

  if existing.id is null then
    return;
  end if;

  update public.mailbox_accounts
  set
    deleted_at = now(),
    secret_ref = null,
    status = 'disabled',
    auth_mode = 'password',
    oauth_provider = null,
    updated_by = actor_id,
    version = existing.version + 1
  where mailbox_accounts.id = existing.id;

  if existing.secret_ref is not null then
    perform private.delete_secret(existing.secret_ref);
  end if;
end;
$$;

-- Cal-Sync-BE: membership-scoped Google Calendar connections + OAuth state.
-- Secrets via private.integration_secrets (mailbox pattern). Never grant secret_ref.

-- ---------------------------------------------------------------------------
-- calendar_connections
-- ---------------------------------------------------------------------------

create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  membership_id uuid not null,
  provider text not null default 'google'
    check (provider in ('google')),
  secret_ref uuid,
  external_account_id text,
  calendar_id text not null default 'primary',
  account_email text,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'error', 'disabled')),
  last_sync_at timestamptz,
  last_error_code text,
  credentials_updated_at timestamptz,
  constraint calendar_connections_org_id_id_key unique (org_id, id),
  constraint calendar_connections_membership_fk
    foreign key (org_id, membership_id)
    references public.memberships (org_id, id)
    on delete cascade,
  constraint calendar_connections_account_email_length_check
    check (
      account_email is null
      or char_length(account_email) between 3 and 320
    ),
  constraint calendar_connections_external_account_length_check
    check (
      external_account_id is null
      or char_length(external_account_id) between 1 and 500
    ),
  constraint calendar_connections_calendar_id_length_check
    check (char_length(calendar_id) between 1 and 500)
);

create unique index calendar_connections_org_membership_provider_uidx
  on public.calendar_connections (org_id, membership_id, provider)
  where deleted_at is null;

create index calendar_connections_org_status_idx
  on public.calendar_connections (org_id, status)
  where deleted_at is null;

create trigger calendar_connections_stamp_business_row
before insert or update on public.calendar_connections
for each row execute function private.stamp_business_row();

alter table public.calendar_connections enable row level security;
revoke all on table public.calendar_connections from public, anon, authenticated;
grant select (
  id, org_id, created_at, updated_at, created_by, updated_by, deleted_at, version,
  membership_id, provider, external_account_id, calendar_id, account_email,
  status, last_sync_at, last_error_code, credentials_updated_at
) on table public.calendar_connections to authenticated;

create policy calendar_connections_select_owner on public.calendar_connections
for select to authenticated
using (
  deleted_at is null
  and membership_id = private.current_membership_id(org_id)
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
);

-- ---------------------------------------------------------------------------
-- meetings: partial unique on external event ids
-- ---------------------------------------------------------------------------

create unique index meetings_org_provider_external_event_uidx
  on public.meetings (org_id, calendar_provider, external_event_id)
  where deleted_at is null
    and calendar_provider is not null
    and external_event_id is not null;

-- ---------------------------------------------------------------------------
-- OAuth CSRF state (private)
-- ---------------------------------------------------------------------------

create table private.calendar_oauth_states (
  state text primary key,
  org_id uuid not null references public.organisations (id) on delete cascade,
  membership_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint calendar_oauth_states_membership_fk
    foreign key (org_id, membership_id)
    references public.memberships (org_id, id)
    on delete cascade
);

revoke all on table private.calendar_oauth_states from public, anon, authenticated;

create index calendar_oauth_states_expires_idx
  on private.calendar_oauth_states (expires_at);

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

create or replace function public.create_calendar_oauth_state(
  p_org_id uuid,
  p_state text,
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
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  delete from private.calendar_oauth_states
  where expires_at < now()
     or (org_id = p_org_id and membership_id = membership_row.id);

  insert into private.calendar_oauth_states (state, org_id, membership_id, expires_at)
  values (
    trim(p_state),
    p_org_id,
    membership_row.id,
    now() + make_interval(secs => greatest(coalesce(p_ttl_seconds, 600), 60))
  );
end;
$$;

revoke all on function public.create_calendar_oauth_state(uuid, text, integer)
  from public, anon;
grant execute on function public.create_calendar_oauth_state(uuid, text, integer)
  to authenticated;

create or replace function public.consume_calendar_oauth_state(
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
  state_row private.calendar_oauth_states;
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
  from private.calendar_oauth_states
  where calendar_oauth_states.state = trim(p_state)
  for update;

  if state_row.state is null then
    raise exception 'OAuth state not found'
      using errcode = 'P0002';
  end if;

  if state_row.expires_at < now() then
    delete from private.calendar_oauth_states where state = state_row.state;
    raise exception 'OAuth state expired'
      using errcode = 'P0001';
  end if;

  if state_row.org_id is distinct from p_org_id
     or state_row.membership_id is distinct from membership_row.id then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  delete from private.calendar_oauth_states where state = state_row.state;

  return jsonb_build_object(
    'org_id', state_row.org_id,
    'membership_id', state_row.membership_id
  );
end;
$$;

revoke all on function public.consume_calendar_oauth_state(uuid, text)
  from public, anon;
grant execute on function public.consume_calendar_oauth_state(uuid, text)
  to authenticated;

create or replace function public.get_calendar_connection(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  membership_row public.memberships;
  existing public.calendar_connections;
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
  from public.calendar_connections
  where calendar_connections.org_id = p_org_id
    and calendar_connections.membership_id = membership_row.id
    and calendar_connections.provider = 'google'
    and calendar_connections.deleted_at is null;

  if existing.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', existing.id,
    'org_id', existing.org_id,
    'membership_id', existing.membership_id,
    'provider', existing.provider,
    'status', existing.status,
    'calendar_id', existing.calendar_id,
    'account_email', existing.account_email,
    'external_account_id', existing.external_account_id,
    'credentials_configured', (existing.secret_ref is not null),
    'credentials_updated_at', existing.credentials_updated_at,
    'last_sync_at', existing.last_sync_at,
    'last_error_code', existing.last_error_code,
    'config', jsonb_build_object(
      'account_email', existing.account_email,
      'calendar_id', existing.calendar_id
    ),
    'version', existing.version,
    'created_at', existing.created_at,
    'updated_at', existing.updated_at
  );
end;
$$;

revoke all on function public.get_calendar_connection(uuid) from public, anon;
grant execute on function public.get_calendar_connection(uuid) to authenticated;

create or replace function public.upsert_calendar_connection_tokens(
  p_org_id uuid,
  p_token_blob text,
  p_account_email text default null,
  p_external_account_id text default null,
  p_calendar_id text default 'primary'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  membership_row public.memberships;
  existing public.calendar_connections;
  new_secret uuid;
  old_secret uuid;
  result_row public.calendar_connections;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if p_token_blob is null or char_length(trim(p_token_blob)) < 8 then
    raise exception 'Token blob is required'
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

  if membership_row.id is null then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  select * into existing
  from public.calendar_connections
  where calendar_connections.org_id = p_org_id
    and calendar_connections.membership_id = membership_row.id
    and calendar_connections.provider = 'google'
    and calendar_connections.deleted_at is null
  for update;

  new_secret := private.store_secret(trim(p_token_blob));

  if existing.id is null then
    insert into public.calendar_connections (
      org_id,
      membership_id,
      provider,
      secret_ref,
      external_account_id,
      calendar_id,
      account_email,
      status,
      credentials_updated_at,
      created_by,
      updated_by
    ) values (
      p_org_id,
      membership_row.id,
      'google',
      new_secret,
      nullif(trim(coalesce(p_external_account_id, '')), ''),
      coalesce(nullif(trim(p_calendar_id), ''), 'primary'),
      nullif(trim(coalesce(p_account_email, '')), ''),
      'active',
      now(),
      actor_id,
      actor_id
    )
    returning * into result_row;
  else
    old_secret := existing.secret_ref;
    update public.calendar_connections
    set
      secret_ref = new_secret,
      external_account_id = coalesce(
        nullif(trim(coalesce(p_external_account_id, '')), ''),
        existing.external_account_id
      ),
      calendar_id = coalesce(nullif(trim(p_calendar_id), ''), existing.calendar_id, 'primary'),
      account_email = coalesce(
        nullif(trim(coalesce(p_account_email, '')), ''),
        existing.account_email
      ),
      status = 'active',
      last_error_code = null,
      credentials_updated_at = now(),
      updated_by = actor_id,
      version = existing.version + 1
    where calendar_connections.id = existing.id
    returning * into result_row;

    if old_secret is not null and old_secret is distinct from new_secret then
      perform private.delete_secret(old_secret);
    end if;
  end if;

  return jsonb_build_object(
    'id', result_row.id,
    'org_id', result_row.org_id,
    'membership_id', result_row.membership_id,
    'provider', result_row.provider,
    'status', result_row.status,
    'calendar_id', result_row.calendar_id,
    'account_email', result_row.account_email,
    'external_account_id', result_row.external_account_id,
    'credentials_configured', (result_row.secret_ref is not null),
    'credentials_updated_at', result_row.credentials_updated_at,
    'last_sync_at', result_row.last_sync_at,
    'last_error_code', result_row.last_error_code,
    'config', jsonb_build_object(
      'account_email', result_row.account_email,
      'calendar_id', result_row.calendar_id
    ),
    'version', result_row.version,
    'created_at', result_row.created_at,
    'updated_at', result_row.updated_at
  );
end;
$$;

revoke all on function public.upsert_calendar_connection_tokens(uuid, text, text, text, text)
  from public, anon;
grant execute on function public.upsert_calendar_connection_tokens(uuid, text, text, text, text)
  to authenticated;

create or replace function public.disconnect_calendar_connection(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  membership_row public.memberships;
  existing public.calendar_connections;
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
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  select * into existing
  from public.calendar_connections
  where calendar_connections.org_id = p_org_id
    and calendar_connections.membership_id = membership_row.id
    and calendar_connections.provider = 'google'
    and calendar_connections.deleted_at is null
  for update;

  if existing.id is null then
    raise exception 'Calendar connection not found'
      using errcode = 'P0002';
  end if;

  update public.calendar_connections
  set
    deleted_at = now(),
    secret_ref = null,
    status = 'disabled',
    updated_by = actor_id,
    version = existing.version + 1
  where calendar_connections.id = existing.id;

  if existing.secret_ref is not null then
    perform private.delete_secret(existing.secret_ref);
  end if;
end;
$$;

revoke all on function public.disconnect_calendar_connection(uuid) from public, anon;
grant execute on function public.disconnect_calendar_connection(uuid) to authenticated;

-- Service-role credential read for Edge push (mirrors mailbox sync credentials).
create or replace function public.read_calendar_connection_credentials(
  p_connection_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.calendar_connections;
  plaintext text;
begin
  select * into existing
  from public.calendar_connections
  where calendar_connections.id = p_connection_id
    and calendar_connections.deleted_at is null;

  if existing.id is null then
    raise exception 'Calendar connection not found'
      using errcode = 'P0002';
  end if;

  if existing.secret_ref is null then
    return jsonb_build_object(
      'id', existing.id,
      'org_id', existing.org_id,
      'membership_id', existing.membership_id,
      'provider', existing.provider,
      'calendar_id', existing.calendar_id,
      'status', existing.status,
      'token_blob', null
    );
  end if;

  plaintext := private.read_secret(existing.secret_ref);

  return jsonb_build_object(
    'id', existing.id,
    'org_id', existing.org_id,
    'membership_id', existing.membership_id,
    'provider', existing.provider,
    'calendar_id', existing.calendar_id,
    'status', existing.status,
    'token_blob', plaintext
  );
end;
$$;

revoke all on function public.read_calendar_connection_credentials(uuid)
  from public, anon, authenticated;
grant execute on function public.read_calendar_connection_credentials(uuid)
  to service_role;

create or replace function public.set_calendar_connection_error(
  p_connection_id uuid,
  p_error_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  existing public.calendar_connections;
begin
  select * into existing
  from public.calendar_connections
  where calendar_connections.id = p_connection_id
    and calendar_connections.deleted_at is null;

  if existing.id is null then
    return;
  end if;

  -- service_role has no auth.uid(); authenticated may only touch own connection.
  if actor_id is not null then
    if existing.membership_id is distinct from private.current_membership_id(existing.org_id) then
      raise exception 'Forbidden'
        using errcode = '42501';
    end if;
  end if;

  update public.calendar_connections
  set
    last_error_code = nullif(trim(coalesce(p_error_code, '')), ''),
    status = case
      when nullif(trim(coalesce(p_error_code, '')), '') is null then 'active'
      else 'error'
    end,
    last_sync_at = now(),
    version = version + 1
  where id = p_connection_id
    and deleted_at is null;
end;
$$;

revoke all on function public.set_calendar_connection_error(uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_calendar_connection_error(uuid, text)
  to service_role;
grant execute on function public.set_calendar_connection_error(uuid, text)
  to authenticated;

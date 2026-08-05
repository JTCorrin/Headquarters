-- CalDAV-BE: allow provider=caldav, config columns, parameterize RPCs, XOR active sync.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

alter table public.calendar_connections
  drop constraint if exists calendar_connections_provider_check;

alter table public.calendar_connections
  add constraint calendar_connections_provider_check
  check (provider in ('google', 'caldav'));

alter table public.calendar_connections
  add column if not exists caldav_url text;

alter table public.calendar_connections
  drop constraint if exists calendar_connections_caldav_url_length_check;

alter table public.calendar_connections
  add constraint calendar_connections_caldav_url_length_check
  check (
    caldav_url is null
    or char_length(caldav_url) between 8 and 2000
  );

grant select (
  id, org_id, created_at, updated_at, created_by, updated_by, deleted_at, version,
  membership_id, provider, external_account_id, calendar_id, account_email,
  caldav_url, status, last_sync_at, last_error_code, credentials_updated_at
) on table public.calendar_connections to authenticated;

-- ---------------------------------------------------------------------------
-- XOR helper: at most one active connection per membership
-- ---------------------------------------------------------------------------

create or replace function private.disable_other_calendar_providers(
  p_org_id uuid,
  p_membership_id uuid,
  p_keep_provider text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.calendar_connections
  set
    status = 'disabled',
    updated_at = now(),
    version = version + 1
  where org_id = p_org_id
    and membership_id = p_membership_id
    and provider is distinct from p_keep_provider
    and deleted_at is null
    and status = 'active';
end;
$$;

revoke all on function private.disable_other_calendar_providers(uuid, uuid, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Status shape helper (shared JSON — never includes secret_ref)
-- ---------------------------------------------------------------------------

create or replace function private.calendar_connection_status_json(
  existing public.calendar_connections
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
begin
  return jsonb_build_object(
    'id', existing.id,
    'org_id', existing.org_id,
    'membership_id', existing.membership_id,
    'provider', existing.provider,
    'status', existing.status,
    'calendar_id', existing.calendar_id,
    'account_email', existing.account_email,
    'external_account_id', existing.external_account_id,
    'caldav_url', existing.caldav_url,
    'credentials_configured', (existing.secret_ref is not null),
    'credentials_updated_at', existing.credentials_updated_at,
    'last_sync_at', existing.last_sync_at,
    'last_error_code', existing.last_error_code,
    'config', case
      when existing.provider = 'caldav' then jsonb_build_object(
        'caldav_url', existing.caldav_url,
        'username', existing.account_email,
        'calendar_id', existing.calendar_id
      )
      else jsonb_build_object(
        'account_email', existing.account_email,
        'calendar_id', existing.calendar_id
      )
    end,
    'version', existing.version,
    'created_at', existing.created_at,
    'updated_at', existing.updated_at
  );
end;
$$;

revoke all on function private.calendar_connection_status_json(public.calendar_connections)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- get_calendar_connection — optional provider; else prefer active row
-- ---------------------------------------------------------------------------

drop function if exists public.get_calendar_connection(uuid);

create or replace function public.get_calendar_connection(
  p_org_id uuid,
  p_provider text default null
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
  provider_filter text := nullif(trim(coalesce(p_provider, '')), '');
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

  if provider_filter is not null then
    if provider_filter not in ('google', 'caldav') then
      raise exception 'Invalid calendar provider'
        using errcode = '22023';
    end if;

    select * into existing
    from public.calendar_connections
    where calendar_connections.org_id = p_org_id
      and calendar_connections.membership_id = membership_row.id
      and calendar_connections.provider = provider_filter
      and calendar_connections.deleted_at is null;
  else
    -- Prefer the active push connection (XOR); else any remaining row.
    select * into existing
    from public.calendar_connections
    where calendar_connections.org_id = p_org_id
      and calendar_connections.membership_id = membership_row.id
      and calendar_connections.deleted_at is null
    order by
      case when calendar_connections.status = 'active' then 0 else 1 end,
      calendar_connections.updated_at desc
    limit 1;
  end if;

  if existing.id is null then
    return null;
  end if;

  return private.calendar_connection_status_json(existing);
end;
$$;

revoke all on function public.get_calendar_connection(uuid, text) from public, anon;
grant execute on function public.get_calendar_connection(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Google token upsert — parameter stays google; XOR-disable caldav on activate
-- ---------------------------------------------------------------------------

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

  perform private.disable_other_calendar_providers(
    p_org_id,
    membership_row.id,
    'google'
  );

  return private.calendar_connection_status_json(result_row);
end;
$$;

revoke all on function public.upsert_calendar_connection_tokens(uuid, text, text, text, text)
  from public, anon;
grant execute on function public.upsert_calendar_connection_tokens(uuid, text, text, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- CalDAV upsert (mailbox-shaped; password in vault; never returned)
-- ---------------------------------------------------------------------------

create or replace function public.upsert_calendar_caldav_connection(
  p_org_id uuid,
  p_caldav_url text,
  p_username text,
  p_password text default null,
  p_calendar_id text default null
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
  url_trimmed text := trim(coalesce(p_caldav_url, ''));
  username_trimmed text := trim(coalesce(p_username, ''));
  calendar_trimmed text := nullif(trim(coalesce(p_calendar_id, '')), '');
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if url_trimmed is null or char_length(url_trimmed) < 8 then
    raise exception 'CalDAV URL is required'
      using errcode = '22023';
  end if;

  if username_trimmed is null or char_length(username_trimmed) < 1 then
    raise exception 'Username is required'
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
    and calendar_connections.provider = 'caldav'
    and calendar_connections.deleted_at is null
  for update;

  if existing.id is null and (p_password is null or length(p_password) = 0) then
    raise exception 'Password is required'
      using errcode = '22023';
  end if;

  if p_password is not null and length(p_password) > 0 then
    new_secret := private.store_secret(
      jsonb_build_object('password', p_password)::text
    );
  end if;

  if existing.id is null then
    insert into public.calendar_connections (
      org_id,
      membership_id,
      provider,
      secret_ref,
      caldav_url,
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
      'caldav',
      new_secret,
      url_trimmed,
      username_trimmed,
      coalesce(calendar_trimmed, 'default'),
      username_trimmed,
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
      caldav_url = url_trimmed,
      account_email = username_trimmed,
      external_account_id = username_trimmed,
      calendar_id = coalesce(calendar_trimmed, existing.calendar_id, 'default'),
      secret_ref = coalesce(new_secret, existing.secret_ref),
      status = 'active',
      last_error_code = null,
      credentials_updated_at = case
        when new_secret is not null then now()
        else existing.credentials_updated_at
      end,
      updated_by = actor_id,
      version = existing.version + 1
    where calendar_connections.id = existing.id
    returning * into result_row;

    if new_secret is not null
       and old_secret is not null
       and old_secret is distinct from new_secret then
      perform private.delete_secret(old_secret);
    end if;
  end if;

  perform private.disable_other_calendar_providers(
    p_org_id,
    membership_row.id,
    'caldav'
  );

  return private.calendar_connection_status_json(result_row);
end;
$$;

revoke all on function public.upsert_calendar_caldav_connection(uuid, text, text, text, text)
  from public, anon;
grant execute on function public.upsert_calendar_caldav_connection(uuid, text, text, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- disconnect — scoped by provider (default google for legacy callers)
-- ---------------------------------------------------------------------------

drop function if exists public.disconnect_calendar_connection(uuid);

create or replace function public.disconnect_calendar_connection(
  p_org_id uuid,
  p_provider text default 'google'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  membership_row public.memberships;
  existing public.calendar_connections;
  provider_filter text := nullif(trim(coalesce(p_provider, '')), '');
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if provider_filter is null or provider_filter not in ('google', 'caldav') then
    raise exception 'Invalid calendar provider'
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
    and calendar_connections.provider = provider_filter
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

revoke all on function public.disconnect_calendar_connection(uuid, text) from public, anon;
grant execute on function public.disconnect_calendar_connection(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Credential read — include caldav config fields for Edge push
-- ---------------------------------------------------------------------------

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
      'account_email', existing.account_email,
      'caldav_url', existing.caldav_url,
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
    'account_email', existing.account_email,
    'caldav_url', existing.caldav_url,
    'status', existing.status,
    'token_blob', plaintext
  );
end;
$$;

revoke all on function public.read_calendar_connection_credentials(uuid)
  from public, anon, authenticated;
grant execute on function public.read_calendar_connection_credentials(uuid)
  to service_role;

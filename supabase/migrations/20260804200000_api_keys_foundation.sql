-- MCP-Keys-BE: org-scoped API keys (crm_key_…) for machine/agent auth.
-- Plan: PLANS/MCP_V1.md (Buzz nest). Secret revealed once; stored as SHA-256 hex.

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  name text not null,
  prefix text not null,
  key_hash text not null,
  role text not null,
  scopes text[] not null default '{}'::text[],
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  constraint api_keys_name_len check (char_length(btrim(name)) between 1 and 120),
  constraint api_keys_prefix_len check (char_length(prefix) between 8 and 64),
  constraint api_keys_key_hash_sha256 check (key_hash ~ '^[0-9a-f]{64}$'),
  constraint api_keys_role_check
    check (role in ('owner', 'admin', 'member', 'billing', 'readonly')),
  constraint api_keys_prefix_key unique (prefix),
  constraint api_keys_key_hash_key unique (key_hash),
  constraint api_keys_revoked_deleted_check
    check (
      revoked_at is null
      or deleted_at is null
      or deleted_at = revoked_at
    )
);

create index api_keys_org_created_idx
  on public.api_keys (org_id, created_at desc, id desc)
  where revoked_at is null and deleted_at is null;

create index api_keys_org_active_hash_idx
  on public.api_keys (org_id, key_hash)
  where revoked_at is null and deleted_at is null;

comment on table public.api_keys is
  'Org-scoped machine credentials (MCP/scripts). Secret shown once; key_hash is SHA-256 hex.';

create trigger api_keys_set_updated_at
before update on public.api_keys
for each row execute function private.set_updated_at();

alter table public.api_keys enable row level security;

revoke all on table public.api_keys from public, anon, authenticated;
grant select on table public.api_keys to authenticated;

create policy api_keys_select_admin
on public.api_keys
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(org_id, array['owner', 'admin'])
);

-- ---------------------------------------------------------------------------
-- Role rank helper (key cannot exceed creator; Owner can mint any role)
-- ---------------------------------------------------------------------------

create or replace function private.membership_role_rank(p_role text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'owner' then 50
    when 'admin' then 40
    when 'member' then 30
    when 'billing' then 20
    when 'readonly' then 10
    else 0
  end;
$$;

revoke all on function private.membership_role_rank(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Authenticated management RPCs
-- ---------------------------------------------------------------------------

create or replace function public.create_org_api_key(
  p_org_id uuid,
  p_name text,
  p_role text default 'member',
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  key_role text := lower(btrim(coalesce(p_role, 'member')));
  key_name text := btrim(coalesce(p_name, ''));
  secret_body text;
  secret text;
  key_prefix text;
  hash_hex text;
  created public.api_keys;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin']) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select memberships.role into actor_role
  from public.memberships
  where memberships.org_id = p_org_id
    and memberships.user_id = actor_id
    and memberships.status = 'active';

  if actor_role is null then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if char_length(key_name) < 1 or char_length(key_name) > 120 then
    raise exception 'Invalid API key name' using errcode = '22023';
  end if;

  if key_role not in ('owner', 'admin', 'member', 'billing', 'readonly') then
    raise exception 'Invalid API key role' using errcode = '22023';
  end if;

  if private.membership_role_rank(key_role) > private.membership_role_rank(actor_role) then
    raise exception 'API key role cannot exceed creator role' using errcode = '42501';
  end if;

  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'expires_at must be in the future' using errcode = '22023';
  end if;

  -- crm_key_ + 32 hex chars (16 random bytes)
  secret_body := encode(extensions.gen_random_bytes(16), 'hex');
  secret := 'crm_key_' || secret_body;
  key_prefix := 'crm_key_' || left(secret_body, 8);
  hash_hex := encode(extensions.digest(secret, 'sha256'), 'hex');

  insert into public.api_keys (
    org_id,
    created_by,
    updated_by,
    name,
    prefix,
    key_hash,
    role,
    scopes,
    expires_at
  )
  values (
    p_org_id,
    actor_id,
    actor_id,
    key_name,
    key_prefix,
    hash_hex,
    key_role,
    '{}'::text[],
    p_expires_at
  )
  returning * into created;

  perform private.append_audit_event(
    p_org_id,
    'user',
    actor_id,
    'api_key.created',
    'api_key',
    created.id,
    null,
    null,
    null,
    null,
    jsonb_build_object(
      'name', created.name,
      'prefix', created.prefix,
      'role', created.role,
      'expires_at', created.expires_at
    ),
    jsonb_build_object('prefix', created.prefix)
  );

  return jsonb_build_object(
    'id', created.id,
    'org_id', created.org_id,
    'name', created.name,
    'prefix', created.prefix,
    'role', created.role,
    'scopes', created.scopes,
    'expires_at', created.expires_at,
    'last_used_at', created.last_used_at,
    'revoked_at', created.revoked_at,
    'created_at', created.created_at,
    'created_by', created.created_by,
    'secret', secret
  );
end;
$$;

revoke all on function public.create_org_api_key(uuid, text, text, timestamptz)
  from public, anon;
grant execute on function public.create_org_api_key(uuid, text, text, timestamptz)
  to authenticated;

create or replace function public.list_org_api_keys(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  rows jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin']) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(item order by created_at desc, id desc), '[]'::jsonb)
  into rows
  from (
    select
      jsonb_build_object(
        'id', k.id,
        'org_id', k.org_id,
        'name', k.name,
        'prefix', k.prefix,
        'role', k.role,
        'scopes', k.scopes,
        'expires_at', k.expires_at,
        'last_used_at', k.last_used_at,
        'revoked_at', k.revoked_at,
        'created_at', k.created_at,
        'created_by', k.created_by
      ) as item,
      k.created_at,
      k.id
    from public.api_keys k
    where k.org_id = p_org_id
      and k.deleted_at is null
      and k.revoked_at is null
    order by k.created_at desc, k.id desc
  ) listed;

  return rows;
end;
$$;

revoke all on function public.list_org_api_keys(uuid) from public, anon;
grant execute on function public.list_org_api_keys(uuid) to authenticated;

create or replace function public.revoke_org_api_key(p_org_id uuid, p_key_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  existing public.api_keys;
  now_ts timestamptz := now();
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin']) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select * into existing
  from public.api_keys
  where api_keys.id = p_key_id
    and api_keys.org_id = p_org_id
    and api_keys.deleted_at is null
  for update;

  if not found then
    raise exception 'API key not found' using errcode = 'P0002';
  end if;

  if existing.revoked_at is not null then
    return jsonb_build_object(
      'id', existing.id,
      'org_id', existing.org_id,
      'name', existing.name,
      'prefix', existing.prefix,
      'role', existing.role,
      'scopes', existing.scopes,
      'expires_at', existing.expires_at,
      'last_used_at', existing.last_used_at,
      'revoked_at', existing.revoked_at,
      'created_at', existing.created_at,
      'created_by', existing.created_by
    );
  end if;

  update public.api_keys
  set
    revoked_at = now_ts,
    deleted_at = now_ts,
    updated_by = actor_id,
    version = existing.version + 1
  where api_keys.id = existing.id
  returning * into existing;

  perform private.append_audit_event(
    p_org_id,
    'user',
    actor_id,
    'api_key.revoked',
    'api_key',
    existing.id,
    null,
    null,
    null,
    jsonb_build_object(
      'name', existing.name,
      'prefix', existing.prefix,
      'role', existing.role
    ),
    jsonb_build_object(
      'name', existing.name,
      'prefix', existing.prefix,
      'role', existing.role,
      'revoked_at', existing.revoked_at
    ),
    jsonb_build_object('prefix', existing.prefix)
  );

  return jsonb_build_object(
    'id', existing.id,
    'org_id', existing.org_id,
    'name', existing.name,
    'prefix', existing.prefix,
    'role', existing.role,
    'scopes', existing.scopes,
    'expires_at', existing.expires_at,
    'last_used_at', existing.last_used_at,
    'revoked_at', existing.revoked_at,
    'created_at', existing.created_at,
    'created_by', existing.created_by
  );
end;
$$;

revoke all on function public.revoke_org_api_key(uuid, uuid) from public, anon;
grant execute on function public.revoke_org_api_key(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Service-role resolve / touch (Edge Bearer crm_key_ auth)
-- ---------------------------------------------------------------------------

create or replace function public.resolve_api_key_by_hash(p_key_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  key_row public.api_keys;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select * into key_row
  from public.api_keys
  where api_keys.key_hash = p_key_hash
    and api_keys.revoked_at is null
    and api_keys.deleted_at is null
    and (api_keys.expires_at is null or api_keys.expires_at > now());

  if not found then
    return null;
  end if;

  if not exists (
    select 1
    from public.organisations
    where organisations.id = key_row.org_id
      and organisations.deleted_at is null
  ) then
    return null;
  end if;

  return jsonb_build_object(
    'id', key_row.id,
    'org_id', key_row.org_id,
    'name', key_row.name,
    'prefix', key_row.prefix,
    'role', key_row.role,
    'scopes', key_row.scopes,
    'expires_at', key_row.expires_at,
    'created_by', key_row.created_by
  );
end;
$$;

revoke all on function public.resolve_api_key_by_hash(text)
  from public, anon, authenticated;
grant execute on function public.resolve_api_key_by_hash(text) to service_role;

create or replace function public.touch_api_key_last_used(p_key_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.api_keys
  set last_used_at = now()
  where api_keys.id = p_key_id
    and api_keys.revoked_at is null
    and api_keys.deleted_at is null;
end;
$$;

revoke all on function public.touch_api_key_last_used(uuid)
  from public, anon, authenticated;
grant execute on function public.touch_api_key_last_used(uuid) to service_role;

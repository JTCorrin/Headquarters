-- Edge serviceRoleDb() uses the Data API as role service_role.
-- With [api] auto_expose_new_tables unset (no implicit grants), public tables
-- were only granted to authenticated — so API-key auth died on memberships
-- SELECT with Organisation context validation failed (PostgREST 42501).
-- RPCs still worked (SECURITY DEFINER + explicit EXECUTE).

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select, update on all sequences in schema public to service_role;

alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges for role postgres in schema public
  grant usage, select, update on sequences to service_role;

-- Defense in depth: resolve returns creator membership so auth does not need a
-- second Data API round-trip for memberships.
create or replace function public.resolve_api_key_by_hash(p_key_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  key_row public.api_keys;
  creator_membership_id uuid;
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

  if key_row.created_by is not null then
    select memberships.id into creator_membership_id
    from public.memberships
    where memberships.org_id = key_row.org_id
      and memberships.user_id = key_row.created_by
      and memberships.status = 'active'
    limit 1;
  end if;

  return jsonb_build_object(
    'id', key_row.id,
    'org_id', key_row.org_id,
    'name', key_row.name,
    'prefix', key_row.prefix,
    'role', key_row.role,
    'scopes', key_row.scopes,
    'expires_at', key_row.expires_at,
    'created_by', key_row.created_by,
    'creator_membership_id', creator_membership_id
  );
end;
$$;

revoke all on function public.resolve_api_key_by_hash(text)
  from public, anon, authenticated;
grant execute on function public.resolve_api_key_by_hash(text) to service_role;

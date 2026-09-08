-- MCP / API-key: allow tag RPCs under service_role with p_actor_id (key created_by).
-- Same pattern as create_project_with_defaults / create_contact_with_primary_client.

drop function if exists public.soft_delete_tag(uuid, uuid, integer);
drop function if exists public.list_entity_tags(uuid, text, uuid);
drop function if exists public.replace_entity_tags(uuid, text, uuid, uuid[]);

create or replace function public.soft_delete_tag(
  p_tag_id uuid,
  p_org_id uuid,
  p_expected_version integer,
  p_actor_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  jwt_uid uuid := auth.uid();
  actor_id uuid;
  tag_row public.tags;
begin
  if jwt_uid is not null then
    actor_id := jwt_uid;
    if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
  elsif auth.role() = 'service_role' then
    if p_actor_id is null then
      raise exception 'Authentication is required'
        using errcode = '42501';
    end if;
    if not exists (
      select 1
      from public.memberships
      join public.organisations
        on organisations.id = memberships.org_id
      where memberships.org_id = p_org_id
        and memberships.user_id = p_actor_id
        and memberships.status = 'active'
        and organisations.deleted_at is null
        and memberships.role = any (array['owner', 'admin', 'member'])
    ) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
    actor_id := p_actor_id;
  else
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  select * into tag_row
  from public.tags
  where tags.id = p_tag_id
    and tags.org_id = p_org_id
    and tags.deleted_at is null
  for update;

  if not found then
    raise exception 'Tag not found'
      using errcode = 'P0002';
  end if;

  if tag_row.version is distinct from p_expected_version then
    raise exception 'Tag version conflict'
      using errcode = 'P0001';
  end if;

  update public.tags
  set
    deleted_at = now(),
    updated_by = actor_id
  where tags.id = tag_row.id;
end;
$$;

revoke all on function public.soft_delete_tag(uuid, uuid, integer, uuid)
  from public, anon;
grant execute on function public.soft_delete_tag(uuid, uuid, integer, uuid)
  to authenticated, service_role;

create or replace function public.replace_entity_tags(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_tag_ids uuid[],
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  jwt_uid uuid := auth.uid();
  actor_id uuid;
  tag_ids uuid[] := coalesce(p_tag_ids, array[]::uuid[]);
  entity_exists boolean := false;
  result jsonb;
begin
  if jwt_uid is not null then
    actor_id := jwt_uid;
    if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
  elsif auth.role() = 'service_role' then
    if p_actor_id is null then
      raise exception 'Authentication is required'
        using errcode = '42501';
    end if;
    if not exists (
      select 1
      from public.memberships
      join public.organisations
        on organisations.id = memberships.org_id
      where memberships.org_id = p_org_id
        and memberships.user_id = p_actor_id
        and memberships.status = 'active'
        and organisations.deleted_at is null
        and memberships.role = any (array['owner', 'admin', 'member'])
    ) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
    actor_id := p_actor_id;
  else
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if p_entity_type not in ('lead', 'contact', 'client') then
    raise exception 'Invalid entity type'
      using errcode = '22023';
  end if;

  if p_entity_type = 'lead' then
    select exists (
      select 1 from public.leads
      where org_id = p_org_id and id = p_entity_id and deleted_at is null
    ) into entity_exists;
  elsif p_entity_type = 'contact' then
    select exists (
      select 1 from public.contacts
      where org_id = p_org_id and id = p_entity_id and deleted_at is null
    ) into entity_exists;
  else
    select exists (
      select 1 from public.clients
      where org_id = p_org_id and id = p_entity_id and deleted_at is null
    ) into entity_exists;
  end if;

  if not entity_exists then
    raise exception 'Entity not found'
      using errcode = 'P0002';
  end if;

  if cardinality(tag_ids) > 50 then
    raise exception 'Too many tags'
      using errcode = '22023';
  end if;

  if cardinality(tag_ids) > 0 then
    if exists (
      select 1
      from unnest(tag_ids) as tid(id)
      left join public.tags t
        on t.id = tid.id
       and t.org_id = p_org_id
       and t.deleted_at is null
      where t.id is null
    ) then
      raise exception 'One or more tags were not found'
        using errcode = 'P0002';
    end if;
  end if;

  delete from public.tag_assignments
  where org_id = p_org_id
    and entity_type = p_entity_type
    and entity_id = p_entity_id
    and (
      cardinality(tag_ids) = 0
      or tag_id <> all (tag_ids)
    );

  insert into public.tag_assignments (org_id, tag_id, entity_type, entity_id, created_by)
  select p_org_id, tid.id, p_entity_type, p_entity_id, actor_id
  from unnest(tag_ids) as tid(id)
  on conflict (org_id, tag_id, entity_type, entity_id) do nothing;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'color', t.color,
        'version', t.version
      )
      order by lower(t.name)
    ),
    '[]'::jsonb
  )
  into result
  from public.tag_assignments a
  join public.tags t
    on t.id = a.tag_id
   and t.org_id = a.org_id
   and t.deleted_at is null
  where a.org_id = p_org_id
    and a.entity_type = p_entity_type
    and a.entity_id = p_entity_id;

  return result;
end;
$$;

revoke all on function public.replace_entity_tags(uuid, text, uuid, uuid[], uuid)
  from public, anon;
grant execute on function public.replace_entity_tags(uuid, text, uuid, uuid[], uuid)
  to authenticated, service_role;

create or replace function public.list_entity_tags(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  jwt_uid uuid := auth.uid();
  result jsonb;
begin
  if jwt_uid is not null then
    if not private.has_org_role(
      p_org_id,
      array['owner', 'admin', 'member', 'readonly']
    ) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
  elsif auth.role() = 'service_role' then
    if p_actor_id is null then
      raise exception 'Authentication is required'
        using errcode = '42501';
    end if;
    if not exists (
      select 1
      from public.memberships
      join public.organisations
        on organisations.id = memberships.org_id
      where memberships.org_id = p_org_id
        and memberships.user_id = p_actor_id
        and memberships.status = 'active'
        and organisations.deleted_at is null
        and memberships.role = any (array['owner', 'admin', 'member', 'readonly'])
    ) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
  else
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if p_entity_type not in ('lead', 'contact', 'client') then
    raise exception 'Invalid entity type'
      using errcode = '22023';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'color', t.color,
        'version', t.version
      )
      order by lower(t.name)
    ),
    '[]'::jsonb
  )
  into result
  from public.tag_assignments a
  join public.tags t
    on t.id = a.tag_id
   and t.org_id = a.org_id
   and t.deleted_at is null
  where a.org_id = p_org_id
    and a.entity_type = p_entity_type
    and a.entity_id = p_entity_id;

  return result;
end;
$$;

revoke all on function public.list_entity_tags(uuid, text, uuid, uuid)
  from public, anon;
grant execute on function public.list_entity_tags(uuid, text, uuid, uuid)
  to authenticated, service_role;

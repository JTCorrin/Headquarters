-- Org-scoped tags + assignments for leads, contacts, and clients.
-- Used by mail campaigns for audience selection.

set search_path = public, extensions, pg_catalog;

-- ---------------------------------------------------------------------------
-- tags
-- ---------------------------------------------------------------------------

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  name text not null check (char_length(name) between 1 and 80),
  color text check (color is null or char_length(color) between 1 and 32),
  constraint tags_org_id_id_key unique (org_id, id)
);

create unique index tags_org_name_uidx
  on public.tags (org_id, lower(name))
  where deleted_at is null;

create index tags_org_created_idx
  on public.tags (org_id, created_at desc, id desc)
  where deleted_at is null;

create trigger tags_stamp_business_row
before insert or update on public.tags
for each row execute function private.stamp_business_row();

alter table public.tags enable row level security;

create policy tags_select_member
on public.tags
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
);

create policy tags_insert_member
on public.tags
for insert
to authenticated
with check (
  private.has_org_role(org_id, array['owner', 'admin', 'member'])
  and created_by = auth.uid()
  and updated_by = auth.uid()
);

create policy tags_update_member
on public.tags
for update
to authenticated
using (
  deleted_at is null
  and private.has_org_role(org_id, array['owner', 'admin', 'member'])
)
with check (
  private.has_org_role(org_id, array['owner', 'admin', 'member'])
  and updated_by = auth.uid()
);

revoke all on table public.tags from public, anon, authenticated;

grant select on table public.tags to authenticated;
grant insert (org_id, name, color) on table public.tags to authenticated;
grant update (name, color, deleted_at) on table public.tags to authenticated;

create or replace function public.soft_delete_tag(
  p_tag_id uuid,
  p_org_id uuid,
  p_expected_version integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  tag_row public.tags;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
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

revoke all on function public.soft_delete_tag(uuid, uuid, integer)
  from public, anon;
grant execute on function public.soft_delete_tag(uuid, uuid, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- tag_assignments
-- ---------------------------------------------------------------------------

create table public.tag_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  tag_id uuid not null,
  entity_type text not null,
  entity_id uuid not null,
  constraint tag_assignments_org_tag_fk
    foreign key (org_id, tag_id)
    references public.tags (org_id, id)
    on delete cascade,
  constraint tag_assignments_entity_type_check
    check (entity_type in ('lead', 'contact', 'client')),
  constraint tag_assignments_org_tag_entity_uidx
    unique (org_id, tag_id, entity_type, entity_id)
);

create index tag_assignments_org_entity_idx
  on public.tag_assignments (org_id, entity_type, entity_id);

create index tag_assignments_org_tag_idx
  on public.tag_assignments (org_id, tag_id);

alter table public.tag_assignments enable row level security;

create policy tag_assignments_select_member
on public.tag_assignments
for select
to authenticated
using (
  private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
);

create policy tag_assignments_insert_member
on public.tag_assignments
for insert
to authenticated
with check (
  private.has_org_role(org_id, array['owner', 'admin', 'member'])
  and created_by = auth.uid()
);

create policy tag_assignments_delete_member
on public.tag_assignments
for delete
to authenticated
using (
  private.has_org_role(org_id, array['owner', 'admin', 'member'])
);

revoke all on table public.tag_assignments from public, anon, authenticated;

grant select on table public.tag_assignments to authenticated;
grant insert (org_id, tag_id, entity_type, entity_id) on table public.tag_assignments to authenticated;
grant delete on table public.tag_assignments to authenticated;

-- Replace entity tag set atomically (security definer for clean upsert).
create or replace function public.replace_entity_tags(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_tag_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  tag_ids uuid[] := coalesce(p_tag_ids, array[]::uuid[]);
  entity_exists boolean := false;
  result jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
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

revoke all on function public.replace_entity_tags(uuid, text, uuid, uuid[])
  from public, anon;
grant execute on function public.replace_entity_tags(uuid, text, uuid, uuid[])
  to authenticated;

create or replace function public.list_entity_tags(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(
    p_org_id,
    array['owner', 'admin', 'member', 'readonly']
  ) then
    raise exception 'This action is not permitted'
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

revoke all on function public.list_entity_tags(uuid, text, uuid)
  from public, anon;
grant execute on function public.list_entity_tags(uuid, text, uuid)
  to authenticated;

-- Projects foundation: projects + project_columns + project_cards, RPCs, RLS.
-- Dictionary §7.6–7.8; unlocks meeting related_entity_type=project.
-- See PLANS/PROJECTS_FOUNDATION_SLICE.md.

set search_path = public, extensions, pg_catalog;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  client_id uuid not null,
  name text not null check (char_length(name) between 1 and 200),
  description text,
  status text not null default 'planning',
  owner_membership_id uuid,
  starts_on date,
  due_on date,
  completed_at timestamptz,
  position numeric(20, 10) not null default 0,
  constraint projects_org_id_id_key unique (org_id, id),
  constraint projects_status_check
    check (status in ('planning', 'active', 'blocked', 'done', 'archived')),
  constraint projects_description_length_check
    check (description is null or char_length(description) <= 20000),
  constraint projects_client_fk
    foreign key (org_id, client_id)
    references public.clients (org_id, id)
    on delete restrict,
  constraint projects_owner_membership_fk
    foreign key (org_id, owner_membership_id)
    references public.memberships (org_id, id)
    on delete set null (owner_membership_id)
);

create index projects_org_created_idx
  on public.projects (org_id, created_at desc, id desc)
  where deleted_at is null;

create index projects_org_status_board_idx
  on public.projects (org_id, status, position, id)
  where deleted_at is null;

create index projects_org_client_idx
  on public.projects (org_id, client_id, created_at desc, id desc)
  where deleted_at is null;

create trigger projects_stamp_business_row
before insert or update on public.projects
for each row execute function private.stamp_business_row();

create table public.project_columns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  project_id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  key text not null check (char_length(key) between 1 and 40),
  position numeric(20, 10) not null default 0,
  wip_limit integer,
  constraint project_columns_org_id_id_key unique (org_id, id),
  constraint project_columns_project_fk
    foreign key (org_id, project_id)
    references public.projects (org_id, id)
    on delete cascade,
  constraint project_columns_key_format_check
    check (key ~ '^[a-z][a-z0-9_-]*$'),
  constraint project_columns_wip_limit_check
    check (wip_limit is null or wip_limit >= 0)
);

create unique index project_columns_project_key_uidx
  on public.project_columns (project_id, key)
  where deleted_at is null;

create index project_columns_project_position_idx
  on public.project_columns (org_id, project_id, position, id)
  where deleted_at is null;

create trigger project_columns_stamp_business_row
before insert or update on public.project_columns
for each row execute function private.stamp_business_row();

create table public.project_cards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  project_id uuid not null,
  column_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  description text,
  assignee_membership_id uuid,
  task_id uuid,
  due_at timestamptz,
  position numeric(20, 10) not null default 0,
  completed_at timestamptz,
  constraint project_cards_org_id_id_key unique (org_id, id),
  constraint project_cards_project_fk
    foreign key (org_id, project_id)
    references public.projects (org_id, id)
    on delete cascade,
  constraint project_cards_column_fk
    foreign key (org_id, column_id)
    references public.project_columns (org_id, id)
    on delete restrict,
  constraint project_cards_assignee_membership_fk
    foreign key (org_id, assignee_membership_id)
    references public.memberships (org_id, id)
    on delete set null (assignee_membership_id),
  constraint project_cards_description_length_check
    check (description is null or char_length(description) <= 20000)
);

create index project_cards_column_position_idx
  on public.project_cards (org_id, column_id, position, id)
  where deleted_at is null;

create index project_cards_project_idx
  on public.project_cards (org_id, project_id, created_at desc, id desc)
  where deleted_at is null;

create trigger project_cards_stamp_business_row
before insert or update on public.project_cards
for each row execute function private.stamp_business_row();

-- ---------------------------------------------------------------------------
-- Validation triggers
-- ---------------------------------------------------------------------------

create or replace function private.validate_project_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_membership_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and new.owner_membership_id is not distinct from old.owner_membership_id
  then
    return new;
  end if;

  if not exists (
    select 1
    from public.memberships
    where memberships.id = new.owner_membership_id
      and memberships.org_id = new.org_id
      and memberships.status = 'active'
  ) then
    raise exception 'Project owner must be an active membership in the same organisation'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger projects_validate_owner
before insert or update of owner_membership_id on public.projects
for each row execute function private.validate_project_owner();

create or replace function private.validate_project_card_column()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  column_project_id uuid;
begin
  if tg_op = 'UPDATE'
    and new.column_id is not distinct from old.column_id
    and new.project_id is not distinct from old.project_id
  then
    return new;
  end if;

  select project_columns.project_id into column_project_id
  from public.project_columns
  where project_columns.id = new.column_id
    and project_columns.org_id = new.org_id
    and project_columns.deleted_at is null;

  if column_project_id is null then
    raise exception 'Project card column not found in organisation'
      using errcode = '23514';
  end if;

  if column_project_id is distinct from new.project_id then
    raise exception 'Project card column must belong to the same project'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.projects
    where projects.id = new.project_id
      and projects.org_id = new.org_id
      and projects.deleted_at is null
  ) then
    raise exception 'Project card project not found in organisation'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger project_cards_validate_column
before insert or update of column_id, project_id on public.project_cards
for each row execute function private.validate_project_card_column();

create or replace function private.validate_project_card_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assignee_membership_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and new.assignee_membership_id is not distinct from old.assignee_membership_id
  then
    return new;
  end if;

  if not exists (
    select 1
    from public.memberships
    where memberships.id = new.assignee_membership_id
      and memberships.org_id = new.org_id
      and memberships.status = 'active'
  ) then
    raise exception 'Project card assignee must be an active membership in the same organisation'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger project_cards_validate_assignee
before insert or update of assignee_membership_id on public.project_cards
for each row execute function private.validate_project_card_assignee();

create or replace function private.validate_project_column_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and new.project_id is not distinct from old.project_id
  then
    return new;
  end if;

  if not exists (
    select 1
    from public.projects
    where projects.id = new.project_id
      and projects.org_id = new.org_id
      and projects.deleted_at is null
  ) then
    raise exception 'Project column project not found in organisation'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger project_columns_validate_project
before insert or update of project_id on public.project_columns
for each row execute function private.validate_project_column_project();

-- ---------------------------------------------------------------------------
-- Unlock meetings related_entity project
-- ---------------------------------------------------------------------------

create or replace function private.validate_meeting_related_entity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.related_entity_type is null and new.related_entity_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and new.related_entity_type is not distinct from old.related_entity_type
    and new.related_entity_id is not distinct from old.related_entity_id
  then
    return new;
  end if;

  if new.related_entity_type = 'project' then
    if not exists (
      select 1 from public.projects
      where projects.id = new.related_entity_id
        and projects.org_id = new.org_id
        and projects.deleted_at is null
    ) then
      raise exception 'Meeting related project not found in organisation'
        using errcode = '23514';
    end if;
  elsif new.related_entity_type = 'contact' then
    if not exists (
      select 1 from public.contacts
      where contacts.id = new.related_entity_id
        and contacts.org_id = new.org_id
        and contacts.deleted_at is null
    ) then
      raise exception 'Meeting related contact not found in organisation'
        using errcode = '23514';
    end if;
  elsif new.related_entity_type = 'lead' then
    if not exists (
      select 1 from public.leads
      where leads.id = new.related_entity_id
        and leads.org_id = new.org_id
        and leads.deleted_at is null
    ) then
      raise exception 'Meeting related lead not found in organisation'
        using errcode = '23514';
    end if;
  elsif new.related_entity_type = 'client' then
    if not exists (
      select 1 from public.clients
      where clients.id = new.related_entity_id
        and clients.org_id = new.org_id
        and clients.deleted_at is null
    ) then
      raise exception 'Meeting related client not found in organisation'
        using errcode = '23514';
    end if;
  else
    raise exception 'Meeting related_entity_type must be client, contact, lead, or project'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

create or replace function public.create_project_with_defaults(
  p_org_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  project_row public.projects;
  client_id uuid;
  project_name text;
  project_status text;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Project payload must be an object'
      using errcode = '22023';
  end if;

  client_id := nullif(p_payload ->> 'client_id', '')::uuid;
  if client_id is null then
    raise exception 'Project client_id is required'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.clients
    where clients.id = client_id
      and clients.org_id = p_org_id
      and clients.deleted_at is null
  ) then
    raise exception 'Project client must be an active client in the same organisation'
      using errcode = '22023';
  end if;

  project_name := nullif(trim(coalesce(p_payload ->> 'name', '')), '');
  if project_name is null or char_length(project_name) > 200 then
    raise exception 'Project name must be between 1 and 200 characters'
      using errcode = '22023';
  end if;

  if p_payload ? 'description'
    and p_payload ->> 'description' is not null
    and char_length(p_payload ->> 'description') > 20000
  then
    raise exception 'Project description must not exceed 20000 characters'
      using errcode = '22023';
  end if;

  project_status := coalesce(nullif(trim(p_payload ->> 'status'), ''), 'planning');
  if project_status not in ('planning', 'active', 'blocked', 'done', 'archived') then
    raise exception 'Project status must be planning, active, blocked, done, or archived'
      using errcode = '22023';
  end if;

  insert into public.projects (
    org_id,
    client_id,
    name,
    description,
    status,
    owner_membership_id,
    starts_on,
    due_on,
    completed_at,
    position,
    created_by,
    updated_by
  )
  values (
    p_org_id,
    client_id,
    project_name,
    nullif(trim(coalesce(p_payload ->> 'description', '')), ''),
    project_status,
    nullif(p_payload ->> 'owner_membership_id', '')::uuid,
    nullif(p_payload ->> 'starts_on', '')::date,
    nullif(p_payload ->> 'due_on', '')::date,
    nullif(p_payload ->> 'completed_at', '')::timestamptz,
    coalesce((p_payload ->> 'position')::numeric(20, 10), 0),
    actor_id,
    actor_id
  )
  returning * into project_row;

  insert into public.project_columns (
    org_id, project_id, name, key, position, created_by, updated_by
  )
  values
    (p_org_id, project_row.id, 'Backlog', 'backlog', 1, actor_id, actor_id),
    (p_org_id, project_row.id, 'Doing', 'doing', 2, actor_id, actor_id),
    (p_org_id, project_row.id, 'Review', 'review', 3, actor_id, actor_id),
    (p_org_id, project_row.id, 'Done', 'done', 4, actor_id, actor_id);

  return (
    select jsonb_build_object(
      'id', p.id,
      'org_id', p.org_id,
      'created_at', p.created_at,
      'updated_at', p.updated_at,
      'created_by', p.created_by,
      'updated_by', p.updated_by,
      'deleted_at', p.deleted_at,
      'version', p.version,
      'client_id', p.client_id,
      'name', p.name,
      'description', p.description,
      'status', p.status,
      'owner_membership_id', p.owner_membership_id,
      'starts_on', p.starts_on,
      'due_on', p.due_on,
      'completed_at', p.completed_at,
      'position', p.position,
      'columns', coalesce(
        (
          select jsonb_agg(
            to_jsonb(c) || jsonb_build_object('cards', '[]'::jsonb)
            order by c.position, c.id
          )
          from public.project_columns c
          where c.project_id = p.id
            and c.org_id = p_org_id
            and c.deleted_at is null
        ),
        '[]'::jsonb
      )
    )
    from public.projects p
    where p.id = project_row.id
  );
end;
$$;

create or replace function public.soft_delete_project(
  p_project_id uuid,
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
  actor_role text;
  project_row public.projects;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  select memberships.role into actor_role
  from public.memberships
  join public.organisations
    on organisations.id = memberships.org_id
  where memberships.org_id = p_org_id
    and memberships.user_id = actor_id
    and memberships.status = 'active'
    and organisations.deleted_at is null;

  if actor_role is null
    or actor_role not in ('owner', 'admin', 'member')
  then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into project_row
  from public.projects
  where projects.id = p_project_id
    and projects.org_id = p_org_id
    and projects.deleted_at is null
  for update;

  if not found then
    raise exception 'Project not found'
      using errcode = 'P0002';
  end if;

  if project_row.version is distinct from p_expected_version then
    raise exception 'Project version conflict'
      using errcode = 'P0001';
  end if;

  if actor_role = 'member'
    and project_row.created_by is distinct from actor_id
  then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  update public.project_cards
  set
    deleted_at = now(),
    updated_by = actor_id
  where project_cards.project_id = project_row.id
    and project_cards.org_id = p_org_id
    and project_cards.deleted_at is null;

  update public.project_columns
  set
    deleted_at = now(),
    updated_by = actor_id
  where project_columns.project_id = project_row.id
    and project_columns.org_id = p_org_id
    and project_columns.deleted_at is null;

  update public.projects
  set
    deleted_at = now(),
    updated_by = actor_id
  where projects.id = project_row.id;
end;
$$;

create or replace function public.soft_delete_project_card(
  p_card_id uuid,
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
  actor_role text;
  card_row public.project_cards;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  select memberships.role into actor_role
  from public.memberships
  join public.organisations
    on organisations.id = memberships.org_id
  where memberships.org_id = p_org_id
    and memberships.user_id = actor_id
    and memberships.status = 'active'
    and organisations.deleted_at is null;

  if actor_role is null
    or actor_role not in ('owner', 'admin', 'member')
  then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into card_row
  from public.project_cards
  where project_cards.id = p_card_id
    and project_cards.org_id = p_org_id
    and project_cards.deleted_at is null
  for update;

  if not found then
    raise exception 'Project card not found'
      using errcode = 'P0002';
  end if;

  if card_row.version is distinct from p_expected_version then
    raise exception 'Project card version conflict'
      using errcode = 'P0001';
  end if;

  if actor_role = 'member'
    and card_row.created_by is distinct from actor_id
  then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  update public.project_cards
  set
    deleted_at = now(),
    updated_by = actor_id
  where project_cards.id = card_row.id;
end;
$$;

create or replace function public.soft_delete_project_column(
  p_column_id uuid,
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
  actor_role text;
  column_row public.project_columns;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  select memberships.role into actor_role
  from public.memberships
  join public.organisations
    on organisations.id = memberships.org_id
  where memberships.org_id = p_org_id
    and memberships.user_id = actor_id
    and memberships.status = 'active'
    and organisations.deleted_at is null;

  if actor_role is null
    or actor_role not in ('owner', 'admin', 'member')
  then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into column_row
  from public.project_columns
  where project_columns.id = p_column_id
    and project_columns.org_id = p_org_id
    and project_columns.deleted_at is null
  for update;

  if not found then
    raise exception 'Project column not found'
      using errcode = 'P0002';
  end if;

  if column_row.version is distinct from p_expected_version then
    raise exception 'Project column version conflict'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.project_cards
    where project_cards.column_id = column_row.id
      and project_cards.org_id = p_org_id
      and project_cards.deleted_at is null
  ) then
    raise exception 'Project column has live cards and cannot be deleted'
      using errcode = '22023';
  end if;

  if actor_role = 'member'
    and not exists (
      select 1
      from public.projects
      where projects.id = column_row.project_id
        and projects.org_id = p_org_id
        and projects.deleted_at is null
        and projects.created_by = actor_id
    )
  then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  update public.project_columns
  set
    deleted_at = now(),
    updated_by = actor_id
  where project_columns.id = column_row.id;
end;
$$;

revoke all on function public.create_project_with_defaults(uuid, jsonb)
  from public, anon;
grant execute on function public.create_project_with_defaults(uuid, jsonb)
  to authenticated;

revoke all on function public.soft_delete_project(uuid, uuid, integer)
  from public, anon;
grant execute on function public.soft_delete_project(uuid, uuid, integer)
  to authenticated;

revoke all on function public.soft_delete_project_card(uuid, uuid, integer)
  from public, anon;
grant execute on function public.soft_delete_project_card(uuid, uuid, integer)
  to authenticated;

revoke all on function public.soft_delete_project_column(uuid, uuid, integer)
  from public, anon;
grant execute on function public.soft_delete_project_column(uuid, uuid, integer)
  to authenticated;

revoke all on function private.validate_project_owner()
  from public, anon, authenticated;
revoke all on function private.validate_project_card_column()
  from public, anon, authenticated;
revoke all on function private.validate_project_card_assignee()
  from public, anon, authenticated;
revoke all on function private.validate_project_column_project()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.projects enable row level security;

create policy projects_select_member
on public.projects
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
);

create policy projects_insert_member
on public.projects
for insert
to authenticated
with check (
  private.has_org_role(
    org_id,
    array['owner', 'admin', 'member']
  )
  and created_by = auth.uid()
  and updated_by = auth.uid()
);

create policy projects_update_owner_admin
on public.projects
for update
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin']
  )
)
with check (
  private.has_org_role(
    org_id,
    array['owner', 'admin']
  )
  and updated_by = auth.uid()
);

create policy projects_update_own_member
on public.projects
for update
to authenticated
using (
  deleted_at is null
  and created_by = auth.uid()
  and private.has_org_role(
    org_id,
    array['member']
  )
)
with check (
  created_by = auth.uid()
  and private.has_org_role(
    org_id,
    array['member']
  )
  and updated_by = auth.uid()
);

grant select, insert, update on table public.projects to authenticated;

alter table public.project_columns enable row level security;

create policy project_columns_select_member
on public.project_columns
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
);

create policy project_columns_insert_member
on public.project_columns
for insert
to authenticated
with check (
  private.has_org_role(
    org_id,
    array['owner', 'admin', 'member']
  )
  and created_by = auth.uid()
  and updated_by = auth.uid()
  and exists (
    select 1
    from public.projects
    where projects.id = project_id
      and projects.org_id = project_columns.org_id
      and projects.deleted_at is null
      and (
        private.has_org_role(projects.org_id, array['owner', 'admin'])
        or projects.created_by = auth.uid()
      )
  )
);

create policy project_columns_update_member
on public.project_columns
for update
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member']
  )
  and exists (
    select 1
    from public.projects
    where projects.id = project_id
      and projects.org_id = project_columns.org_id
      and projects.deleted_at is null
      and (
        private.has_org_role(projects.org_id, array['owner', 'admin'])
        or projects.created_by = auth.uid()
      )
  )
)
with check (
  private.has_org_role(
    org_id,
    array['owner', 'admin', 'member']
  )
  and updated_by = auth.uid()
  and exists (
    select 1
    from public.projects
    where projects.id = project_id
      and projects.org_id = project_columns.org_id
      and projects.deleted_at is null
      and (
        private.has_org_role(projects.org_id, array['owner', 'admin'])
        or projects.created_by = auth.uid()
      )
  )
);

grant select, insert, update on table public.project_columns to authenticated;

alter table public.project_cards enable row level security;

create policy project_cards_select_member
on public.project_cards
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
);

create policy project_cards_insert_member
on public.project_cards
for insert
to authenticated
with check (
  private.has_org_role(
    org_id,
    array['owner', 'admin', 'member']
  )
  and created_by = auth.uid()
  and updated_by = auth.uid()
  and exists (
    select 1
    from public.projects
    where projects.id = project_id
      and projects.org_id = project_cards.org_id
      and projects.deleted_at is null
      and (
        private.has_org_role(projects.org_id, array['owner', 'admin'])
        or projects.created_by = auth.uid()
      )
  )
);

create policy project_cards_update_owner_admin
on public.project_cards
for update
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin']
  )
)
with check (
  private.has_org_role(
    org_id,
    array['owner', 'admin']
  )
  and updated_by = auth.uid()
);

create policy project_cards_update_own_member
on public.project_cards
for update
to authenticated
using (
  deleted_at is null
  and created_by = auth.uid()
  and private.has_org_role(
    org_id,
    array['member']
  )
)
with check (
  created_by = auth.uid()
  and private.has_org_role(
    org_id,
    array['member']
  )
  and updated_by = auth.uid()
);

grant select, insert, update on table public.project_cards to authenticated;

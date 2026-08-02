-- Tasks foundation: first-class tasks table, soft-delete RPC, RLS.
-- Dictionary §7.1; no meetings/agents/projects in this slice.
-- See PLANS/TASKS_FOUNDATION_SLICE.md.

set search_path = public, extensions, pg_catalog;

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  title text not null check (char_length(title) between 1 and 200),
  description text,
  priority text not null default 'p3',
  status text not null default 'open',
  assignee_membership_id uuid,
  assignee_agent_id uuid,
  due_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  blocked_reason text,
  source text not null default 'manual',
  entity_type text,
  entity_id uuid,
  meeting_id uuid,
  project_card_id uuid,
  position numeric(20, 10) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  constraint tasks_org_id_id_key unique (org_id, id),
  constraint tasks_priority_check
    check (priority in ('p1', 'p2', 'p3', 'p4')),
  constraint tasks_status_check
    check (status in ('open', 'in_progress', 'blocked', 'done', 'cancelled')),
  constraint tasks_source_check
    check (source in ('manual', 'meeting', 'email', 'workflow', 'agent')),
  constraint tasks_entity_pair_check
    check (
      (entity_type is null and entity_id is null)
      or (entity_type is not null and entity_id is not null)
    ),
  constraint tasks_entity_type_check
    check (
      entity_type is null
      or entity_type in ('contact', 'lead', 'client')
    ),
  constraint tasks_assignee_membership_fk
    foreign key (org_id, assignee_membership_id)
    references public.memberships (org_id, id)
    on delete set null (assignee_membership_id),
  constraint tasks_metadata_object_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint tasks_blocked_reason_length_check
    check (
      blocked_reason is null
      or char_length(blocked_reason) between 1 and 2000
    ),
  constraint tasks_description_length_check
    check (
      description is null
      or char_length(description) <= 20000
    )
);

create index tasks_org_created_idx
  on public.tasks (org_id, created_at desc, id desc)
  where deleted_at is null;

create index tasks_org_status_idx
  on public.tasks (org_id, status, created_at desc, id desc)
  where deleted_at is null;

create index tasks_org_assignee_idx
  on public.tasks (org_id, assignee_membership_id, created_at desc, id desc)
  where deleted_at is null and assignee_membership_id is not null;

create index tasks_org_entity_idx
  on public.tasks (org_id, entity_type, entity_id)
  where deleted_at is null and entity_type is not null;

create index tasks_org_board_position_idx
  on public.tasks (org_id, status, position, id)
  where deleted_at is null;

create trigger tasks_stamp_business_row
before insert or update on public.tasks
for each row execute function private.stamp_business_row();

create or replace function private.validate_task_assignee()
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
    raise exception 'Task assignee must be an active membership in the same organisation'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger tasks_validate_assignee
before insert or update of assignee_membership_id on public.tasks
for each row execute function private.validate_task_assignee();

create or replace function private.validate_task_entity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.entity_type is null and new.entity_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and new.entity_type is not distinct from old.entity_type
    and new.entity_id is not distinct from old.entity_id
  then
    return new;
  end if;

  if new.entity_type = 'contact' then
    if not exists (
      select 1 from public.contacts
      where contacts.id = new.entity_id
        and contacts.org_id = new.org_id
        and contacts.deleted_at is null
    ) then
      raise exception 'Task entity contact not found in organisation'
        using errcode = '23514';
    end if;
  elsif new.entity_type = 'lead' then
    if not exists (
      select 1 from public.leads
      where leads.id = new.entity_id
        and leads.org_id = new.org_id
        and leads.deleted_at is null
    ) then
      raise exception 'Task entity lead not found in organisation'
        using errcode = '23514';
    end if;
  elsif new.entity_type = 'client' then
    if not exists (
      select 1 from public.clients
      where clients.id = new.entity_id
        and clients.org_id = new.org_id
        and clients.deleted_at is null
    ) then
      raise exception 'Task entity client not found in organisation'
        using errcode = '23514';
    end if;
  else
    raise exception 'Task entity_type must be contact, lead, or client'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger tasks_validate_entity
before insert or update of entity_type, entity_id on public.tasks
for each row execute function private.validate_task_entity();

create or replace function public.soft_delete_task(
  p_task_id uuid,
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
  task_row public.tasks;
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

  select * into task_row
  from public.tasks
  where tasks.id = p_task_id
    and tasks.org_id = p_org_id
    and tasks.deleted_at is null
  for update;

  if not found then
    raise exception 'Task not found'
      using errcode = 'P0002';
  end if;

  if task_row.version is distinct from p_expected_version then
    raise exception 'Task version conflict'
      using errcode = 'P0001';
  end if;

  -- Members may delete only tasks they created; owner/admin may delete any.
  if actor_role = 'member'
    and task_row.created_by is distinct from actor_id
  then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  update public.tasks
  set
    deleted_at = now(),
    updated_by = actor_id
  where tasks.id = task_row.id;
end;
$$;

revoke all on function public.soft_delete_task(uuid, uuid, integer)
  from public, anon;
grant execute on function public.soft_delete_task(uuid, uuid, integer)
  to authenticated;

revoke all on function private.validate_task_assignee()
  from public, anon, authenticated;
revoke all on function private.validate_task_entity()
  from public, anon, authenticated;

alter table public.tasks enable row level security;

create policy tasks_select_member
on public.tasks
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
);

create policy tasks_insert_member
on public.tasks
for insert
to authenticated
with check (
  private.has_org_role(
    org_id,
    array['owner', 'admin', 'member']
  )
  and created_by = auth.uid()
  and updated_by = auth.uid()
  and assignee_agent_id is null
);

create policy tasks_update_owner_admin
on public.tasks
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
  and assignee_agent_id is null
);

create policy tasks_update_own_member
on public.tasks
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
  and assignee_agent_id is null
);

grant select, insert, update on table public.tasks to authenticated;

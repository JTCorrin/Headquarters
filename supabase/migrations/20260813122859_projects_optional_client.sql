-- Allow projects without a client (internal work). Null client_id is Internal.

set search_path = public, extensions, pg_catalog;

alter table public.projects
  alter column client_id drop not null;

drop index if exists public.projects_org_client_idx;

create index projects_org_client_idx
  on public.projects (org_id, client_id, created_at desc, id desc)
  where deleted_at is null and client_id is not null;

create or replace function private.validate_project_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.client_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and new.client_id is not distinct from old.client_id
  then
    return new;
  end if;

  if not exists (
    select 1
    from public.clients
    where clients.id = new.client_id
      and clients.org_id = new.org_id
      and clients.deleted_at is null
  ) then
    raise exception 'Project client must be an active client in the same organisation'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists projects_validate_client on public.projects;

create trigger projects_validate_client
before insert or update of client_id on public.projects
for each row execute function private.validate_project_client();

create or replace function public.create_project_with_defaults(
  p_org_id uuid,
  p_payload jsonb,
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
  project_row public.projects;
  client_id uuid;
  project_name text;
  project_status text;
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

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Project payload must be an object'
      using errcode = '22023';
  end if;

  client_id := nullif(p_payload ->> 'client_id', '')::uuid;

  if client_id is not null
    and not exists (
      select 1
      from public.clients
      where clients.id = client_id
        and clients.org_id = p_org_id
        and clients.deleted_at is null
    )
  then
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

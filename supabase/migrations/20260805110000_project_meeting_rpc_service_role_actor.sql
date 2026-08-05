-- MCP Wave B: project create + meeting attendees under API-key / service_role.
-- Same pattern as contact hotfix #139: grant EXECUTE + p_actor_id when auth.uid() is null.

drop function if exists public.create_project_with_defaults(uuid, jsonb);
drop function if exists public.replace_meeting_attendees(uuid, uuid, jsonb);

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


create or replace function public.replace_meeting_attendees(
  p_meeting_id uuid,
  p_org_id uuid,
  p_attendees jsonb,
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
  actor_role text;
  meeting_row public.meetings;
  attendee jsonb;
  attendee_email text;
  attendee_name text;
  attendee_contact_id uuid;
  attendee_membership_id uuid;
  attendee_organiser boolean;
  attendee_response_status text;
  attendee_attended boolean;
  seen_emails text[] := array[]::text[];
  result jsonb;
begin
  if jwt_uid is not null then
    actor_id := jwt_uid;
  elsif auth.role() = 'service_role' then
    if p_actor_id is null then
      raise exception 'Authentication is required'
        using errcode = '42501';
    end if;
    actor_id := p_actor_id;
  else
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if p_attendees is null or jsonb_typeof(p_attendees) <> 'array' then
    raise exception 'Meeting attendees must be an array'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_attendees) > 200 then
    raise exception 'Meeting cannot exceed 200 attendees'
      using errcode = '22023';
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

  select * into meeting_row
  from public.meetings
  where meetings.id = p_meeting_id
    and meetings.org_id = p_org_id
    and meetings.deleted_at is null
  for update;

  if not found then
    raise exception 'Meeting not found'
      using errcode = 'P0002';
  end if;

  -- Members may replace attendees only on meetings they created; owner/admin any.
  if actor_role = 'member'
    and meeting_row.created_by is distinct from actor_id
  then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  update public.meeting_attendees
  set
    deleted_at = now(),
    updated_by = actor_id
  where meeting_attendees.meeting_id = meeting_row.id
    and meeting_attendees.org_id = p_org_id
    and meeting_attendees.deleted_at is null;

  for attendee in
    select value
    from jsonb_array_elements(p_attendees) with ordinality as t(value, ord)
    order by ord
  loop
    if jsonb_typeof(attendee) <> 'object' then
      raise exception 'Meeting attendee must be an object'
        using errcode = '22023';
    end if;

    attendee_email := lower(trim(coalesce(attendee ->> 'email', '')));
    if attendee_email = ''
      or char_length(attendee_email) < 3
      or char_length(attendee_email) > 320
      or position('@' in attendee_email) = 0
    then
      raise exception 'Meeting attendee email is invalid'
        using errcode = '22023';
    end if;

    if attendee_email = any (seen_emails) then
      raise exception 'Meeting attendee email is duplicated'
        using errcode = '22023';
    end if;
    seen_emails := array_append(seen_emails, attendee_email);

    attendee_name := nullif(trim(coalesce(attendee ->> 'name', '')), '');
    if attendee_name is not null
      and (
        char_length(attendee_name) < 1
        or char_length(attendee_name) > 200
      )
    then
      raise exception 'Meeting attendee name must be between 1 and 200 characters when set'
        using errcode = '22023';
    end if;

    attendee_contact_id := nullif(attendee ->> 'contact_id', '')::uuid;
    attendee_membership_id := nullif(attendee ->> 'membership_id', '')::uuid;
    attendee_organiser := coalesce((attendee ->> 'organiser')::boolean, false);
    attendee_response_status := nullif(attendee ->> 'response_status', '');
    if attendee ? 'attended' and attendee ->> 'attended' is not null then
      attendee_attended := (attendee ->> 'attended')::boolean;
    else
      attendee_attended := null;
    end if;

    if attendee_response_status is not null
      and attendee_response_status not in (
        'needs_action',
        'accepted',
        'declined',
        'tentative'
      )
    then
      raise exception 'Meeting attendee response_status is invalid'
        using errcode = '22023';
    end if;

    insert into public.meeting_attendees (
      org_id,
      meeting_id,
      email,
      name,
      contact_id,
      membership_id,
      organiser,
      response_status,
      attended,
      created_by,
      updated_by
    )
    values (
      p_org_id,
      meeting_row.id,
      attendee_email,
      attendee_name,
      attendee_contact_id,
      attendee_membership_id,
      attendee_organiser,
      attendee_response_status,
      attendee_attended,
      actor_id,
      actor_id
    );
  end loop;

  select coalesce(
    jsonb_agg(to_jsonb(a) order by a.created_at asc, a.id asc),
    '[]'::jsonb
  )
  into result
  from public.meeting_attendees a
  where a.meeting_id = meeting_row.id
    and a.org_id = p_org_id
    and a.deleted_at is null;

  return result;
end;
$$;

revoke all on function public.create_project_with_defaults(uuid, jsonb, uuid)
  from public, anon;
grant execute on function public.create_project_with_defaults(uuid, jsonb, uuid)
  to authenticated, service_role;

revoke all on function public.replace_meeting_attendees(uuid, uuid, jsonb, uuid)
  from public, anon;
grant execute on function public.replace_meeting_attendees(uuid, uuid, jsonb, uuid)
  to authenticated, service_role;

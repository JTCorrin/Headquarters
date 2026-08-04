-- MP-Glue: task entity_type=project, accept inherits meeting related entity,
-- meeting/proposal timeline fan-out onto related entity rails.
-- See PLANS/MEETINGS_PROJECTS_MCP_GATE_SLICES.md.

set search_path = public, extensions, pg_catalog;

-- ---------------------------------------------------------------------------
-- Tasks: allow entity_type=project + project_card list index
-- ---------------------------------------------------------------------------

alter table public.tasks
  drop constraint tasks_entity_type_check;

alter table public.tasks
  add constraint tasks_entity_type_check
  check (
    entity_type is null
    or entity_type in ('contact', 'lead', 'client', 'project')
  );

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
  elsif new.entity_type = 'project' then
    if not exists (
      select 1 from public.projects
      where projects.id = new.entity_id
        and projects.org_id = new.org_id
        and projects.deleted_at is null
    ) then
      raise exception 'Task entity project not found in organisation'
        using errcode = '23514';
    end if;
  else
    raise exception 'Task entity_type must be contact, lead, client, or project'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create index if not exists tasks_org_project_card_idx
  on public.tasks (org_id, project_card_id)
  where deleted_at is null and project_card_id is not null;

-- ---------------------------------------------------------------------------
-- Timeline fan-out helper (related contact/lead/client; project → client rail)
-- ---------------------------------------------------------------------------

create or replace function private.fanout_meeting_related_timeline(
  p_meeting public.meetings,
  p_kind text,
  p_title text,
  p_body text,
  p_actor_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rail_type text;
  rail_id uuid;
  project_client_id uuid;
  payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if p_meeting.related_entity_type is null
    or p_meeting.related_entity_id is null
  then
    return;
  end if;

  if p_meeting.related_entity_type in ('contact', 'lead', 'client') then
    rail_type := p_meeting.related_entity_type;
    rail_id := p_meeting.related_entity_id;
  elsif p_meeting.related_entity_type = 'project' then
    select projects.client_id into project_client_id
    from public.projects
    where projects.id = p_meeting.related_entity_id
      and projects.org_id = p_meeting.org_id
      and projects.deleted_at is null;

    if project_client_id is null then
      return;
    end if;

    rail_type := 'client';
    rail_id := project_client_id;
    payload := payload || jsonb_build_object(
      'project_id', p_meeting.related_entity_id
    );
  else
    return;
  end if;

  perform private.append_timeline_event(
    p_meeting.org_id,
    rail_type,
    rail_id,
    p_kind,
    p_title,
    p_body,
    p_actor_id,
    p_source_type,
    p_source_id,
    payload
  );
end;
$$;

revoke all on function private.fanout_meeting_related_timeline(
  public.meetings, text, text, text, uuid, text, uuid, jsonb
) from public, anon, authenticated;

create or replace function private.meetings_related_timeline_writer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if new.deleted_at is null
      and new.related_entity_type is not null
      and new.related_entity_id is not null
    then
      perform private.fanout_meeting_related_timeline(
        new,
        'meeting',
        'Meeting scheduled',
        new.title,
        coalesce(actor_id, new.created_by),
        'meeting',
        new.id,
        jsonb_build_object(
          'action', 'meeting.scheduled',
          'meeting_id', new.id,
          'status', new.status
        )
      );
    end if;
    return new;
  end if;

  if new.deleted_at is null
    and new.status is distinct from old.status
    and new.status in ('completed', 'cancelled')
    and new.related_entity_type is not null
    and new.related_entity_id is not null
  then
    perform private.fanout_meeting_related_timeline(
      new,
      'meeting',
      case
        when new.status = 'completed' then 'Meeting completed'
        else 'Meeting cancelled'
      end,
      new.title,
      coalesce(actor_id, new.updated_by),
      'meeting',
      new.id,
      jsonb_build_object(
        'action', case
          when new.status = 'completed' then 'meeting.completed'
          else 'meeting.cancelled'
        end,
        'meeting_id', new.id,
        'status', new.status
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists meetings_related_timeline_writer on public.meetings;
create trigger meetings_related_timeline_writer
after insert or update of status on public.meetings
for each row execute function private.meetings_related_timeline_writer();

-- ---------------------------------------------------------------------------
-- Accept proposal: inherit related entity + task timeline card
-- ---------------------------------------------------------------------------

create or replace function public.accept_meeting_task_proposal(
  p_org_id uuid,
  p_meeting_id uuid,
  p_proposal_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_meeting public.meetings;
  v_proposal public.meeting_task_proposals;
  v_task_id uuid;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted' using errcode = '42501';
  end if;

  select * into v_meeting
  from public.meetings
  where id = p_meeting_id
    and org_id = p_org_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'Meeting not found' using errcode = 'P0002';
  end if;

  if not (
    private.has_org_role(p_org_id, array['owner', 'admin'])
    or v_meeting.created_by = v_actor_id
  ) then
    raise exception 'This action is not permitted' using errcode = '42501';
  end if;

  select * into v_proposal
  from public.meeting_task_proposals
  where id = p_proposal_id
    and org_id = p_org_id
    and meeting_id = p_meeting_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'Task proposal not found' using errcode = 'P0002';
  end if;

  if v_proposal.status <> 'proposed' then
    raise exception 'Task proposal is not open for accept' using errcode = 'P0001';
  end if;

  insert into public.tasks (
    org_id,
    title,
    description,
    assignee_membership_id,
    due_at,
    source,
    meeting_id,
    entity_type,
    entity_id,
    status,
    priority,
    created_by,
    updated_by
  ) values (
    p_org_id,
    v_proposal.title,
    v_proposal.description,
    v_proposal.suggested_assignee_membership_id,
    v_proposal.suggested_due_at,
    'meeting',
    p_meeting_id,
    v_meeting.related_entity_type,
    v_meeting.related_entity_id,
    'open',
    'p3',
    v_actor_id,
    v_actor_id
  )
  returning id into v_task_id;

  update public.meeting_task_proposals
  set
    status = 'accepted',
    accepted_task_id = v_task_id,
    decided_at = now(),
    decided_by = v_actor_id,
    updated_by = v_actor_id
  where id = v_proposal.id;

  perform private.fanout_meeting_related_timeline(
    v_meeting,
    'task',
    'Task created from meeting',
    v_proposal.title,
    v_actor_id,
    'task',
    v_task_id,
    jsonb_build_object(
      'action', 'meeting.task_accepted',
      'meeting_id', p_meeting_id,
      'proposal_id', p_proposal_id,
      'task_id', v_task_id
    )
  );

  return jsonb_build_object(
    'accepted_task_id', v_task_id,
    'proposal_id', v_proposal.id,
    'meeting_id', p_meeting_id
  );
end;
$$;

revoke all on function public.accept_meeting_task_proposal(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.accept_meeting_task_proposal(uuid, uuid, uuid)
  to authenticated;

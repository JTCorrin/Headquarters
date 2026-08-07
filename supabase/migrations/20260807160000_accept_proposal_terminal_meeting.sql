-- Reject task-proposal accept when the meeting is already terminal
-- (completed / cancelled). Checked under the meeting row lock.

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
  v_actor_membership_id uuid;
  v_assignee_membership_id uuid;
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

  v_actor_membership_id := private.current_membership_id(p_org_id);
  if v_actor_membership_id is null then
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

  if v_meeting.status in ('completed', 'cancelled') then
    raise exception 'Meeting is not open for accept' using errcode = 'P0001';
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

  -- Prefer an explicit suggestion; otherwise assign to the member who accepted.
  v_assignee_membership_id := coalesce(
    v_proposal.suggested_assignee_membership_id,
    v_actor_membership_id
  );

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
    v_assignee_membership_id,
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
    'meeting_id', p_meeting_id,
    'assignee_membership_id', v_assignee_membership_id
  );
end;
$$;

revoke all on function public.accept_meeting_task_proposal(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.accept_meeting_task_proposal(uuid, uuid, uuid)
  to authenticated;

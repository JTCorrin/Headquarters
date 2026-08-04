-- Phase 2 A1 + A2:
-- A1: recurring lifecycle Idempotency-Key store+replay; accept_meeting_task_proposal RPC
-- A2: ai_suggestions SELECT → creator or source-email mailbox owner only

-- ---------------------------------------------------------------------------
-- A1 — recurring schedule lifecycle with idempotency
-- ---------------------------------------------------------------------------

create or replace function public.recurring_schedule_lifecycle_idempotent(
  p_command text,
  p_schedule_id uuid,
  p_org_id uuid,
  p_expected_version integer,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_route text,
  p_ttl_seconds integer default 86400
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_existing public.api_idempotency_keys;
  v_expires_at timestamptz := now() + make_interval(secs => greatest(coalesce(p_ttl_seconds, 86400), 60));
  v_document jsonb;
  v_flat_data jsonb;
  v_response_headers jsonb;
  v_response_body jsonb;
  v_command text := lower(trim(coalesce(p_command, '')));
begin
  if v_actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_org_id is null
    or p_idempotency_key_hash is null
    or char_length(p_idempotency_key_hash) <> 64
    or p_request_hash is null
    or char_length(p_request_hash) <> 64
    or p_route is null
    or char_length(p_route) < 1
  then
    raise exception 'Idempotency claim parameters are invalid' using errcode = '22023';
  end if;
  if v_command not in ('activate', 'pause', 'resume', 'cancel') then
    raise exception 'Unsupported recurring lifecycle command' using errcode = '22023';
  end if;
  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted' using errcode = '42501';
  end if;

  loop
    select * into v_existing
    from public.api_idempotency_keys
    where api_idempotency_keys.org_id = p_org_id
      and api_idempotency_keys.actor_type = 'user'
      and api_idempotency_keys.actor_id = v_actor_id
      and api_idempotency_keys.idempotency_key_hash = p_idempotency_key_hash
    for update;

    if found then
      if v_existing.expires_at > now() then
        if v_existing.request_hash is distinct from p_request_hash
          or v_existing.route is distinct from p_route
        then
          raise exception 'Idempotency-Key was reused with a different request payload'
            using errcode = '23505';
        end if;
        if v_existing.response_status is not null and v_existing.response_body is not null then
          return jsonb_build_object(
            'replay', true,
            'response_status', v_existing.response_status,
            'response_body', v_existing.response_body -> 'body',
            'response_headers', coalesce(v_existing.response_body -> 'headers', '{}'::jsonb)
          );
        end if;
        raise exception 'An identical request is already in progress' using errcode = '55000';
      end if;
      delete from public.api_idempotency_keys where id = v_existing.id;
    end if;

    begin
      insert into public.api_idempotency_keys (
        org_id, actor_type, actor_id, idempotency_key_hash, route, request_hash, expires_at
      ) values (
        p_org_id, 'user', v_actor_id, p_idempotency_key_hash, p_route, p_request_hash, v_expires_at
      );
      exit;
    exception
      when unique_violation then
        null;
    end;
  end loop;

  if v_command = 'activate' then
    v_document := public.activate_recurring_schedule(
      p_schedule_id, p_org_id, p_expected_version
    );
  elsif v_command = 'pause' then
    v_document := public.pause_recurring_schedule(
      p_schedule_id, p_org_id, p_expected_version
    );
  elsif v_command = 'resume' then
    v_document := public.resume_recurring_schedule(
      p_schedule_id, p_org_id, p_expected_version
    );
  else
    v_document := public.cancel_recurring_schedule(
      p_schedule_id, p_org_id, p_expected_version
    );
  end if;

  -- Flatten to the same Edge shape as activate/pause/resume/cancel today:
  -- { data: { ...scheduleFields, lines: [...] } }
  v_flat_data := coalesce(v_document -> 'schedule', '{}'::jsonb)
    || jsonb_build_object('lines', coalesce(v_document -> 'lines', '[]'::jsonb));
  v_response_headers := jsonb_build_object(
    'etag', '"' || (v_flat_data ->> 'version') || '"'
  );
  v_response_body := jsonb_build_object(
    'status', 200,
    'body', jsonb_build_object('data', v_flat_data),
    'headers', v_response_headers
  );

  update public.api_idempotency_keys
  set
    response_status = 200,
    response_body = v_response_body,
    resource_type = 'recurring_invoice_schedule',
    resource_id = p_schedule_id
  where api_idempotency_keys.org_id = p_org_id
    and api_idempotency_keys.actor_type = 'user'
    and api_idempotency_keys.actor_id = v_actor_id
    and api_idempotency_keys.idempotency_key_hash = p_idempotency_key_hash;

  return jsonb_build_object(
    'replay', false,
    'response_status', 200,
    'response_body', v_response_body -> 'body',
    'response_headers', v_response_headers
  );
end;
$$;

revoke all on function public.recurring_schedule_lifecycle_idempotent(
  text, uuid, uuid, integer, text, text, text, integer
) from public, anon;
grant execute on function public.recurring_schedule_lifecycle_idempotent(
  text, uuid, uuid, integer, text, text, text, integer
) to authenticated;

-- ---------------------------------------------------------------------------
-- A1 — accept meeting task proposal (task insert + proposal update atomic)
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

-- ---------------------------------------------------------------------------
-- A2 — AI suggestions SELECT ACL
-- ---------------------------------------------------------------------------

drop policy if exists ai_suggestions_select_member on public.ai_suggestions;

create policy ai_suggestions_select_creator_or_mailbox_owner
on public.ai_suggestions
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(org_id, array['owner', 'admin', 'member', 'readonly'])
  and (
    created_by = auth.uid()
    or (
      source_email_message_id is not null
      and private.message_owned_by_current_member(source_email_message_id, org_id)
    )
  )
);

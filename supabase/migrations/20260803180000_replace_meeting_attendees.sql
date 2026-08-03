-- Replace-all meeting attendees via SECURITY DEFINER (soft-delete + insert in one txn).
-- Authenticated UPDATE of deleted_at on meeting_attendees fails RLS WITH CHECK; mirror soft_delete_meeting.

create or replace function public.replace_meeting_attendees(
  p_meeting_id uuid,
  p_org_id uuid,
  p_attendees jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
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
  if actor_id is null then
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

revoke all on function public.replace_meeting_attendees(uuid, uuid, jsonb)
  from public, anon;
grant execute on function public.replace_meeting_attendees(uuid, uuid, jsonb)
  to authenticated;

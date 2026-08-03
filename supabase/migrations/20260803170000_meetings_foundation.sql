-- Meetings foundation: meetings + meeting_attendees, soft-delete RPC, RLS.
-- Dictionary §7.2–7.3; §7.4–7.5 deferred to M2 (status columns default none).
-- Wire documents assert for meeting entity_type (was reserved stub).
-- See PLANS/MEETINGS_FOUNDATION_SLICE.md.

set search_path = public, extensions, pg_catalog;

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  title text not null check (char_length(title) between 1 and 200),
  status text not null default 'scheduled',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null check (char_length(timezone) between 1 and 64),
  location text,
  meeting_url text,
  organiser_membership_id uuid,
  related_entity_type text,
  related_entity_id uuid,
  calendar_provider text,
  external_event_id text,
  transcript_status text not null default 'none',
  summary_status text not null default 'none',
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  constraint meetings_org_id_id_key unique (org_id, id),
  constraint meetings_status_check
    check (status in ('scheduled', 'in_progress', 'completed', 'cancelled')),
  constraint meetings_ends_after_starts_check
    check (ends_at > starts_at),
  constraint meetings_related_entity_pair_check
    check (
      (related_entity_type is null and related_entity_id is null)
      or (related_entity_type is not null and related_entity_id is not null)
    ),
  constraint meetings_related_entity_type_check
    check (
      related_entity_type is null
      or related_entity_type in ('client', 'contact', 'lead', 'project')
    ),
  constraint meetings_organiser_membership_fk
    foreign key (org_id, organiser_membership_id)
    references public.memberships (org_id, id)
    on delete set null (organiser_membership_id),
  constraint meetings_transcript_status_check
    check (
      transcript_status in ('none', 'uploaded', 'processing', 'ready', 'failed')
    ),
  constraint meetings_summary_status_check
    check (
      summary_status in ('none', 'generating', 'ready', 'failed')
    ),
  constraint meetings_location_length_check
    check (location is null or char_length(location) between 1 and 500),
  constraint meetings_meeting_url_length_check
    check (meeting_url is null or char_length(meeting_url) between 1 and 2000),
  constraint meetings_calendar_provider_length_check
    check (
      calendar_provider is null
      or char_length(calendar_provider) between 1 and 64
    ),
  constraint meetings_external_event_id_length_check
    check (
      external_event_id is null
      or char_length(external_event_id) between 1 and 500
    ),
  constraint meetings_summary_length_check
    check (summary is null or char_length(summary) <= 50000),
  constraint meetings_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create index meetings_org_created_idx
  on public.meetings (org_id, created_at desc, id desc)
  where deleted_at is null;

create index meetings_org_status_idx
  on public.meetings (org_id, status, created_at desc, id desc)
  where deleted_at is null;

create index meetings_org_starts_idx
  on public.meetings (org_id, starts_at asc, id asc)
  where deleted_at is null;

create index meetings_org_related_idx
  on public.meetings (org_id, related_entity_type, related_entity_id)
  where deleted_at is null and related_entity_type is not null;

create trigger meetings_stamp_business_row
before insert or update on public.meetings
for each row execute function private.stamp_business_row();

create table public.meeting_attendees (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  meeting_id uuid not null,
  contact_id uuid,
  membership_id uuid,
  name text,
  email extensions.citext not null,
  response_status text,
  attended boolean,
  organiser boolean not null default false,
  constraint meeting_attendees_org_id_id_key unique (org_id, id),
  constraint meeting_attendees_meeting_fk
    foreign key (org_id, meeting_id)
    references public.meetings (org_id, id)
    on delete cascade,
  constraint meeting_attendees_contact_fk
    foreign key (org_id, contact_id)
    references public.contacts (org_id, id)
    on delete set null (contact_id),
  constraint meeting_attendees_membership_fk
    foreign key (org_id, membership_id)
    references public.memberships (org_id, id)
    on delete set null (membership_id),
  constraint meeting_attendees_email_length_check
    check (char_length(email::text) between 3 and 320),
  constraint meeting_attendees_name_length_check
    check (name is null or char_length(name) between 1 and 200),
  constraint meeting_attendees_response_status_check
    check (
      response_status is null
      or response_status in (
        'needs_action',
        'accepted',
        'declined',
        'tentative'
      )
    )
);

create unique index meeting_attendees_meeting_email_uidx
  on public.meeting_attendees (meeting_id, email)
  where deleted_at is null;

create index meeting_attendees_meeting_idx
  on public.meeting_attendees (org_id, meeting_id, created_at asc, id asc)
  where deleted_at is null;

create trigger meeting_attendees_stamp_business_row
before insert or update on public.meeting_attendees
for each row execute function private.stamp_business_row();

-- ---------------------------------------------------------------------------
-- Validation triggers
-- ---------------------------------------------------------------------------

create or replace function private.validate_meeting_organiser()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organiser_membership_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and new.organiser_membership_id is not distinct from old.organiser_membership_id
  then
    return new;
  end if;

  if not exists (
    select 1
    from public.memberships
    where memberships.id = new.organiser_membership_id
      and memberships.org_id = new.org_id
      and memberships.status = 'active'
  ) then
    raise exception 'Meeting organiser must be an active membership in the same organisation'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger meetings_validate_organiser
before insert or update of organiser_membership_id on public.meetings
for each row execute function private.validate_meeting_organiser();

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
    -- projects table lands in P1; accept enum, reject until then.
    raise exception 'Meeting related_entity_type project is not available until Projects foundation'
      using errcode = '22023';
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

create trigger meetings_validate_related_entity
before insert or update of related_entity_type, related_entity_id on public.meetings
for each row execute function private.validate_meeting_related_entity();

create or replace function private.validate_meeting_attendee_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.contact_id is not null
    and (
      tg_op = 'INSERT'
      or new.contact_id is distinct from old.contact_id
    )
    and not exists (
      select 1
      from public.contacts
      where contacts.id = new.contact_id
        and contacts.org_id = new.org_id
        and contacts.deleted_at is null
    )
  then
    raise exception 'Meeting attendee contact must be an active contact in the same organisation'
      using errcode = '23514';
  end if;

  if new.membership_id is not null
    and (
      tg_op = 'INSERT'
      or new.membership_id is distinct from old.membership_id
    )
    and not exists (
      select 1
      from public.memberships
      where memberships.id = new.membership_id
        and memberships.org_id = new.org_id
        and memberships.status = 'active'
    )
  then
    raise exception 'Meeting attendee membership must be active in the same organisation'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.meetings
    where meetings.id = new.meeting_id
      and meetings.org_id = new.org_id
      and meetings.deleted_at is null
  ) then
    raise exception 'Meeting attendee meeting not found in organisation'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger meeting_attendees_validate_refs
before insert or update of meeting_id, contact_id, membership_id, org_id
on public.meeting_attendees
for each row execute function private.validate_meeting_attendee_refs();

-- ---------------------------------------------------------------------------
-- Soft delete
-- ---------------------------------------------------------------------------

create or replace function public.soft_delete_meeting(
  p_meeting_id uuid,
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
  meeting_row public.meetings;
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

  if meeting_row.version is distinct from p_expected_version then
    raise exception 'Meeting version conflict'
      using errcode = 'P0001';
  end if;

  -- Members may delete only meetings they created; owner/admin may delete any.
  if actor_role = 'member'
    and meeting_row.created_by is distinct from actor_id
  then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  update public.meetings
  set
    deleted_at = now(),
    updated_by = actor_id
  where meetings.id = meeting_row.id;

  update public.meeting_attendees
  set
    deleted_at = now(),
    updated_by = actor_id
  where meeting_attendees.meeting_id = meeting_row.id
    and meeting_attendees.org_id = p_org_id
    and meeting_attendees.deleted_at is null;
end;
$$;

revoke all on function public.soft_delete_meeting(uuid, uuid, integer)
  from public, anon;
grant execute on function public.soft_delete_meeting(uuid, uuid, integer)
  to authenticated;

revoke all on function private.validate_meeting_organiser()
  from public, anon, authenticated;
revoke all on function private.validate_meeting_related_entity()
  from public, anon, authenticated;
revoke all on function private.validate_meeting_attendee_refs()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.meetings enable row level security;

create policy meetings_select_member
on public.meetings
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
);

create policy meetings_insert_member
on public.meetings
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

create policy meetings_update_owner_admin
on public.meetings
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

create policy meetings_update_own_member
on public.meetings
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

grant select, insert, update on table public.meetings to authenticated;

alter table public.meeting_attendees enable row level security;

create policy meeting_attendees_select_member
on public.meeting_attendees
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
);

create policy meeting_attendees_insert_member
on public.meeting_attendees
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
    from public.meetings
    where meetings.id = meeting_id
      and meetings.org_id = meeting_attendees.org_id
      and meetings.deleted_at is null
      and (
        private.has_org_role(meetings.org_id, array['owner', 'admin'])
        or meetings.created_by = auth.uid()
      )
  )
);

create policy meeting_attendees_update_member
on public.meeting_attendees
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
    from public.meetings
    where meetings.id = meeting_id
      and meetings.org_id = meeting_attendees.org_id
      and meetings.deleted_at is null
      and (
        private.has_org_role(meetings.org_id, array['owner', 'admin'])
        or meetings.created_by = auth.uid()
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
    from public.meetings
    where meetings.id = meeting_id
      and meetings.org_id = meeting_attendees.org_id
      and meetings.deleted_at is null
      and (
        private.has_org_role(meetings.org_id, array['owner', 'admin'])
        or meetings.created_by = auth.uid()
      )
  )
);

grant select, insert, update on table public.meeting_attendees to authenticated;

-- ---------------------------------------------------------------------------
-- Documents: resolve meeting entity when linking/uploading
-- ---------------------------------------------------------------------------

create or replace function private.assert_document_entity_exists(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_document_entity_type(p_entity_type);

  if p_entity_id is null then
    raise exception 'Document entity_id is required'
      using errcode = '22023';
  end if;

  if p_entity_type = 'client' then
    if not exists (
      select 1
      from public.clients
      where clients.id = p_entity_id
        and clients.org_id = p_org_id
        and clients.deleted_at is null
    ) then
      raise exception 'Document client must be an active client in the same organisation'
        using errcode = '22023';
    end if;
  elsif p_entity_type = 'contact' then
    if not exists (
      select 1
      from public.contacts
      where contacts.id = p_entity_id
        and contacts.org_id = p_org_id
        and contacts.deleted_at is null
    ) then
      raise exception 'Document contact must be an active contact in the same organisation'
        using errcode = '22023';
    end if;
  elsif p_entity_type = 'lead' then
    if not exists (
      select 1
      from public.leads
      where leads.id = p_entity_id
        and leads.org_id = p_org_id
        and leads.deleted_at is null
    ) then
      raise exception 'Document lead must be an active lead in the same organisation'
        using errcode = '22023';
    end if;
  elsif p_entity_type = 'organisation' then
    if p_entity_id is distinct from p_org_id
      or not exists (
        select 1
        from public.organisations
        where organisations.id = p_org_id
          and organisations.deleted_at is null
      )
    then
      raise exception 'Document organisation entity must match the active organisation'
        using errcode = '22023';
    end if;
  elsif p_entity_type = 'meeting' then
    if not exists (
      select 1
      from public.meetings
      where meetings.id = p_entity_id
        and meetings.org_id = p_org_id
        and meetings.deleted_at is null
    ) then
      raise exception 'Document meeting must be an active meeting in the same organisation'
        using errcode = '22023';
    end if;
  elsif p_entity_type = 'bill' then
    if not exists (
      select 1
      from public.bills
      where bills.id = p_entity_id
        and bills.org_id = p_org_id
        and bills.deleted_at is null
    ) then
      raise exception 'Document bill must be an active bill in the same organisation'
        using errcode = '22023';
    end if;
  end if;
end;
$$;

revoke all on function private.assert_document_entity_exists(uuid, text, uuid)
  from public, anon, authenticated;

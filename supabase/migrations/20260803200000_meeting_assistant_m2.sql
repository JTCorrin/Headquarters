-- Meeting assistant M2: transcripts + task proposals, soft-delete cascade,
-- optional tasks.meeting_id FK. Dictionary §7.4–7.5.
-- See PLANS/MEETING_ASSISTANT_M2_SLICE.md.

set search_path = public, extensions, pg_catalog;

-- ---------------------------------------------------------------------------
-- §7.4 meeting_transcripts
-- ---------------------------------------------------------------------------

create table public.meeting_transcripts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  meeting_id uuid not null,
  document_id uuid,
  provider text,
  language_code text,
  status text not null default 'uploaded',
  plain_text text,
  segments jsonb,
  processed_at timestamptz,
  error_code text,
  constraint meeting_transcripts_org_id_id_key unique (org_id, id),
  constraint meeting_transcripts_meeting_fk
    foreign key (org_id, meeting_id)
    references public.meetings (org_id, id)
    on delete cascade,
  constraint meeting_transcripts_document_fk
    foreign key (org_id, document_id)
    references public.documents (org_id, id)
    on delete set null (document_id),
  constraint meeting_transcripts_status_check
    check (status in ('uploaded', 'processing', 'ready', 'failed')),
  constraint meeting_transcripts_provider_length_check
    check (provider is null or char_length(provider) between 1 and 64),
  constraint meeting_transcripts_language_code_length_check
    check (
      language_code is null
      or char_length(language_code) between 2 and 32
    ),
  constraint meeting_transcripts_plain_text_length_check
    check (plain_text is null or char_length(plain_text) <= 500000),
  constraint meeting_transcripts_error_code_length_check
    check (error_code is null or char_length(error_code) between 1 and 64),
  constraint meeting_transcripts_segments_object_or_array_check
    check (
      segments is null
      or jsonb_typeof(segments) in ('object', 'array')
    )
);

create unique index meeting_transcripts_one_live_uidx
  on public.meeting_transcripts (org_id, meeting_id)
  where deleted_at is null;

create index meeting_transcripts_meeting_idx
  on public.meeting_transcripts (org_id, meeting_id, created_at desc)
  where deleted_at is null;

create trigger meeting_transcripts_stamp_business_row
before insert or update on public.meeting_transcripts
for each row execute function private.stamp_business_row();

-- ---------------------------------------------------------------------------
-- §7.5 meeting_task_proposals
-- ---------------------------------------------------------------------------

create table public.meeting_task_proposals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  meeting_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  description text,
  suggested_assignee_membership_id uuid,
  suggested_due_at timestamptz,
  confidence numeric(5, 4),
  status text not null default 'proposed',
  accepted_task_id uuid,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  constraint meeting_task_proposals_org_id_id_key unique (org_id, id),
  constraint meeting_task_proposals_meeting_fk
    foreign key (org_id, meeting_id)
    references public.meetings (org_id, id)
    on delete cascade,
  constraint meeting_task_proposals_assignee_fk
    foreign key (org_id, suggested_assignee_membership_id)
    references public.memberships (org_id, id)
    on delete set null (suggested_assignee_membership_id),
  constraint meeting_task_proposals_accepted_task_fk
    foreign key (org_id, accepted_task_id)
    references public.tasks (org_id, id)
    on delete set null (accepted_task_id),
  constraint meeting_task_proposals_status_check
    check (status in ('proposed', 'accepted', 'dismissed')),
  constraint meeting_task_proposals_confidence_check
    check (
      confidence is null
      or (confidence >= 0 and confidence <= 1)
    ),
  constraint meeting_task_proposals_description_length_check
    check (
      description is null
      or char_length(description) <= 20000
    ),
  constraint meeting_task_proposals_decided_pair_check
    check (
      (decided_at is null and decided_by is null)
      or (decided_at is not null and decided_by is not null)
    ),
  constraint meeting_task_proposals_accepted_task_status_check
    check (
      (status = 'accepted' and accepted_task_id is not null)
      or (status <> 'accepted' and accepted_task_id is null)
    )
);

create index meeting_task_proposals_meeting_idx
  on public.meeting_task_proposals (org_id, meeting_id, created_at asc, id asc)
  where deleted_at is null;

create index meeting_task_proposals_status_idx
  on public.meeting_task_proposals (org_id, meeting_id, status)
  where deleted_at is null;

create trigger meeting_task_proposals_stamp_business_row
before insert or update on public.meeting_task_proposals
for each row execute function private.stamp_business_row();

-- Optional FK for tasks extracted from meetings.
alter table public.tasks
  add constraint tasks_meeting_fk
    foreign key (org_id, meeting_id)
    references public.meetings (org_id, id)
    on delete set null (meeting_id);

create index tasks_org_meeting_idx
  on public.tasks (org_id, meeting_id)
  where deleted_at is null and meeting_id is not null;

-- ---------------------------------------------------------------------------
-- Soft-delete cascade for assistant rows
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

  update public.meeting_transcripts
  set
    deleted_at = now(),
    updated_by = actor_id
  where meeting_transcripts.meeting_id = meeting_row.id
    and meeting_transcripts.org_id = p_org_id
    and meeting_transcripts.deleted_at is null;

  update public.meeting_task_proposals
  set
    deleted_at = now(),
    updated_by = actor_id
  where meeting_task_proposals.meeting_id = meeting_row.id
    and meeting_task_proposals.org_id = p_org_id
    and meeting_task_proposals.deleted_at is null;
end;
$$;

revoke all on function public.soft_delete_meeting(uuid, uuid, integer)
  from public, anon;
grant execute on function public.soft_delete_meeting(uuid, uuid, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- RLS (mirror attendees: meeting owner/admin or creator)
-- ---------------------------------------------------------------------------

alter table public.meeting_transcripts enable row level security;

create policy meeting_transcripts_select_member
on public.meeting_transcripts
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
);

create policy meeting_transcripts_insert_member
on public.meeting_transcripts
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
      and meetings.org_id = meeting_transcripts.org_id
      and meetings.deleted_at is null
      and (
        private.has_org_role(meetings.org_id, array['owner', 'admin'])
        or meetings.created_by = auth.uid()
      )
  )
);

create policy meeting_transcripts_update_member
on public.meeting_transcripts
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
      and meetings.org_id = meeting_transcripts.org_id
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
      and meetings.org_id = meeting_transcripts.org_id
      and meetings.deleted_at is null
      and (
        private.has_org_role(meetings.org_id, array['owner', 'admin'])
        or meetings.created_by = auth.uid()
      )
  )
);

grant select, insert, update on table public.meeting_transcripts to authenticated;

alter table public.meeting_task_proposals enable row level security;

create policy meeting_task_proposals_select_member
on public.meeting_task_proposals
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
);

create policy meeting_task_proposals_insert_member
on public.meeting_task_proposals
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
      and meetings.org_id = meeting_task_proposals.org_id
      and meetings.deleted_at is null
      and (
        private.has_org_role(meetings.org_id, array['owner', 'admin'])
        or meetings.created_by = auth.uid()
      )
  )
);

create policy meeting_task_proposals_update_member
on public.meeting_task_proposals
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
      and meetings.org_id = meeting_task_proposals.org_id
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
      and meetings.org_id = meeting_task_proposals.org_id
      and meetings.deleted_at is null
      and (
        private.has_org_role(meetings.org_id, array['owner', 'admin'])
        or meetings.created_by = auth.uid()
      )
  )
);

grant select, insert, update on table public.meeting_task_proposals to authenticated;

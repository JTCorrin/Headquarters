begin;

select plan(13);

select has_table('public', 'meeting_transcripts', 'meeting_transcripts table exists');
select has_table('public', 'meeting_task_proposals', 'meeting_task_proposals table exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.meeting_transcripts'::regclass),
  'meeting_transcripts have row level security enabled'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.meeting_task_proposals'::regclass),
  'meeting_task_proposals have row level security enabled'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'meeting_transcripts'
      and indexname = 'meeting_transcripts_one_live_uidx'
  ),
  'one live transcript per meeting index exists'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'tasks_meeting_fk'
  ),
  'tasks.meeting_id FK to meetings exists'
);

create temporary table _m2_fixture (
  owner_id uuid,
  member_id uuid,
  org_id uuid,
  owner_meeting_id uuid,
  owner_meeting_version integer,
  member_meeting_id uuid,
  member_meeting_version integer,
  transcript_id uuid,
  proposal_id uuid,
  accepted_task_id uuid
) on commit drop;

grant all on table _m2_fixture to authenticated;

create or replace function pg_temp.make_auth_user(p_email text, p_name text)
returns uuid
language plpgsql
as $$
declare
  created_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    created_id, 'authenticated', 'authenticated', p_email,
    extensions.crypt('m2-test-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('display_name', p_name),
    now(), now(), '', '', '', ''
  );
  return created_id;
end;
$$;

create or replace function pg_temp.as_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true
  );
end;
$$;
grant execute on function pg_temp.as_user(uuid) to authenticated;

insert into _m2_fixture (owner_id, member_id)
values (
  pg_temp.make_auth_user('m2-owner@example.test', 'M2 Owner'),
  pg_temp.make_auth_user('m2-member@example.test', 'M2 Member')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency, timezone)
  values (
    'M2 Assistant Org',
    'm2-assistant-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP',
    'Europe/London'
  )
  returning id
)
update _m2_fixture
set org_id = created_org.id
from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _m2_fixture;
insert into public.memberships (org_id, user_id, role, status)
select org_id, member_id, 'member', 'active' from _m2_fixture;

select pg_temp.as_user((select owner_id from _m2_fixture));
set local role authenticated;

with owner_meeting as (
  insert into public.meetings (
    org_id, title, starts_at, ends_at, timezone, created_by, updated_by
  )
  select
    org_id,
    'Owner briefing',
    now() + interval '1 day',
    now() + interval '1 day 1 hour',
    'Europe/London',
    owner_id,
    owner_id
  from _m2_fixture
  returning id, version
)
update _m2_fixture
set
  owner_meeting_id = owner_meeting.id,
  owner_meeting_version = owner_meeting.version
from owner_meeting;

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);

select pg_temp.as_user((select member_id from _m2_fixture));
set local role authenticated;

with member_meeting as (
  insert into public.meetings (
    org_id, title, starts_at, ends_at, timezone, created_by, updated_by
  )
  select
    org_id,
    'Member sync',
    now() + interval '2 days',
    now() + interval '2 days 1 hour',
    'Europe/London',
    member_id,
    member_id
  from _m2_fixture
  returning id, version
)
update _m2_fixture
set
  member_meeting_id = member_meeting.id,
  member_meeting_version = member_meeting.version
from member_meeting;

with transcript as (
  insert into public.meeting_transcripts (
    org_id, meeting_id, status, plain_text, processed_at
  )
  select
    org_id,
    member_meeting_id,
    'ready',
    E'Action: send proposal\nAction: schedule follow-up',
    now()
  from _m2_fixture
  returning id
)
update _m2_fixture
set transcript_id = transcript.id
from transcript;

update public.meetings
set transcript_status = 'ready'
where id = (select member_meeting_id from _m2_fixture);

with proposal as (
  insert into public.meeting_task_proposals (
    org_id, meeting_id, title, description, confidence, status
  )
  select
    org_id,
    member_meeting_id,
    'Send proposal',
    'From transcript',
    0.9000,
    'proposed'
  from _m2_fixture
  returning id
)
update _m2_fixture
set proposal_id = proposal.id
from proposal;

select is(
  (select status from public.meeting_transcripts where id = (select transcript_id from _m2_fixture)),
  'ready',
  'member can insert ready transcript on own meeting'
);

select throws_ok(
  $$
    insert into public.meeting_transcripts (
      org_id, meeting_id, status, plain_text
    )
    select
      org_id,
      owner_meeting_id,
      'ready',
      'should fail'
    from _m2_fixture
  $$,
  '42501',
  null,
  'member cannot insert transcript on owner meeting'
);

with accepted as (
  insert into public.tasks (
    org_id, title, source, meeting_id, status, priority
  )
  select
    org_id,
    'Send proposal',
    'meeting',
    member_meeting_id,
    'open',
    'p3'
  from _m2_fixture
  returning id
),
updated as (
  update public.meeting_task_proposals
  set
    status = 'accepted',
    accepted_task_id = accepted.id,
    decided_by = (select member_id from _m2_fixture),
    decided_at = now()
  from accepted
  where meeting_task_proposals.id = (select proposal_id from _m2_fixture)
  returning meeting_task_proposals.accepted_task_id
)
update _m2_fixture
set accepted_task_id = updated.accepted_task_id
from updated;

select is(
  (
    select status
    from public.meeting_task_proposals
    where id = (select proposal_id from _m2_fixture)
  ),
  'accepted',
  'member can accept proposal on own meeting'
);

select is(
  (
    select source
    from public.tasks
    where id = (select accepted_task_id from _m2_fixture)
  ),
  'meeting',
  'accepted proposal creates meeting-sourced task'
);

select lives_ok(
  $$
    select public.soft_delete_meeting(
      (select member_meeting_id from _m2_fixture),
      (select org_id from _m2_fixture),
      (select version from public.meetings where id = (select member_meeting_id from _m2_fixture))
    )
  $$,
  'member can soft-delete own meeting with assistant rows'
);

select is(
  (
    select count(*)::integer
    from public.meeting_transcripts
    where meeting_id = (select member_meeting_id from _m2_fixture)
      and deleted_at is null
  ),
  0,
  'soft-delete cascades to transcripts'
);

select is(
  (
    select count(*)::integer
    from public.meeting_task_proposals
    where meeting_id = (select member_meeting_id from _m2_fixture)
      and deleted_at is null
  ),
  0,
  'soft-delete cascades to task proposals'
);

select * from finish();
rollback;

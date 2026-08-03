begin;

select plan(18);

select has_table('public', 'meetings', 'meetings table exists');
select has_table('public', 'meeting_attendees', 'meeting_attendees table exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.meetings'::regclass),
  'meetings have row level security enabled'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.meeting_attendees'::regclass),
  'meeting_attendees have row level security enabled'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.soft_delete_meeting(uuid, uuid, integer)',
    'execute'
  ),
  'authenticated users can execute soft_delete_meeting'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'meetings'
      and indexname = 'meetings_org_starts_idx'
  ),
  'meetings starts_at index exists'
);

create temporary table _meetings_fixture (
  owner_id uuid,
  member_id uuid,
  member_membership_id uuid,
  billing_id uuid,
  outsider_id uuid,
  org_id uuid,
  other_org_id uuid,
  contact_id uuid,
  client_id uuid,
  project_id uuid,
  owner_meeting_id uuid,
  owner_meeting_version integer,
  member_meeting_id uuid,
  member_meeting_version integer
) on commit drop;

grant all on table _meetings_fixture to authenticated;

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
    extensions.crypt('meetings-test-password', extensions.gen_salt('bf')),
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

insert into _meetings_fixture (owner_id, member_id, billing_id, outsider_id)
values (
  pg_temp.make_auth_user('meetings-owner@example.test', 'Meetings Owner'),
  pg_temp.make_auth_user('meetings-member@example.test', 'Meetings Member'),
  pg_temp.make_auth_user('meetings-billing@example.test', 'Meetings Billing'),
  pg_temp.make_auth_user('meetings-outsider@example.test', 'Meetings Outsider')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency, timezone)
  values (
    'Meetings Org',
    'meetings-org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP',
    'Europe/London'
  )
  returning id
),
other_org as (
  insert into public.organisations (name, slug, country_code)
  values (
    'Other Meetings Org',
    'other-meetings-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB'
  )
  returning id
)
update _meetings_fixture
set org_id = created_org.id, other_org_id = other_org.id
from created_org, other_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _meetings_fixture;
insert into public.memberships (org_id, user_id, role, status)
select org_id, member_id, 'member', 'active' from _meetings_fixture;
insert into public.memberships (org_id, user_id, role, status)
select org_id, billing_id, 'billing', 'active' from _meetings_fixture;
insert into public.memberships (org_id, user_id, role, status)
select other_org_id, outsider_id, 'owner', 'active' from _meetings_fixture;

update _meetings_fixture
set member_membership_id = memberships.id
from public.memberships
where memberships.org_id = _meetings_fixture.org_id
  and memberships.user_id = _meetings_fixture.member_id;

with created_contact as (
  insert into public.contacts (org_id, display_name, primary_email, created_by, updated_by)
  select org_id, 'Ada Contact', 'ada@meetings.test', owner_id, owner_id
  from _meetings_fixture
  returning id
)
update _meetings_fixture
set contact_id = created_contact.id
from created_contact;

with created_client as (
  insert into public.clients (org_id, name, status, created_by, updated_by)
  select org_id, 'Meetings Client', 'active', owner_id, owner_id
  from _meetings_fixture
  returning id
)
update _meetings_fixture
set client_id = created_client.id
from created_client;

select pg_temp.as_user((select owner_id from _meetings_fixture));
set local role authenticated;

with created_project as (
  select public.create_project_with_defaults(
    (select org_id from _meetings_fixture),
    jsonb_build_object(
      'client_id', (select client_id from _meetings_fixture),
      'name', 'Meetings linked project'
    )
  ) as doc
)
update _meetings_fixture
set project_id = (created_project.doc ->> 'id')::uuid
from created_project;

reset role;
-- Clear JWT so stamp_business_row does not overwrite created_by on fixture inserts.
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);

with owner_meeting as (
  insert into public.meetings (
    org_id, title, status, starts_at, ends_at, timezone,
    related_entity_type, related_entity_id, organiser_membership_id,
    created_by, updated_by
  )
  select
    org_id,
    'Owner standup',
    'scheduled',
    now() + interval '1 day',
    now() + interval '1 day 1 hour',
    'Europe/London',
    'contact',
    contact_id,
    member_membership_id,
    owner_id,
    owner_id
  from _meetings_fixture
  returning id, version
)
update _meetings_fixture
set
  owner_meeting_id = owner_meeting.id,
  owner_meeting_version = owner_meeting.version
from owner_meeting;

insert into public.meeting_attendees (
  org_id, meeting_id, email, name, contact_id, organiser, created_by, updated_by
)
select
  org_id,
  owner_meeting_id,
  'ada@meetings.test',
  'Ada Contact',
  contact_id,
  true,
  owner_id,
  owner_id
from _meetings_fixture;

with member_meeting as (
  insert into public.meetings (
    org_id, title, starts_at, ends_at, timezone, created_by, updated_by
  )
  select
    org_id,
    'Member sync',
    now() + interval '2 days',
    now() + interval '2 days 30 minutes',
    'UTC',
    member_id,
    member_id
  from _meetings_fixture
  returning id, version
)
update _meetings_fixture
set
  member_meeting_id = member_meeting.id,
  member_meeting_version = member_meeting.version
from member_meeting;

select is(
  (select status from public.meetings where id = (select member_meeting_id from _meetings_fixture)),
  'scheduled',
  'status defaults to scheduled'
);

select is(
  (
    select transcript_status
    from public.meetings
    where id = (select member_meeting_id from _meetings_fixture)
  ),
  'none',
  'transcript_status defaults to none'
);

select throws_ok(
  $$
  insert into public.meetings (
    org_id, title, starts_at, ends_at, timezone,
    related_entity_type, related_entity_id, created_by, updated_by
  )
  select
    org_id,
    'Missing project',
    now() + interval '3 days',
    now() + interval '3 days 1 hour',
    'UTC',
    'project',
    gen_random_uuid(),
    owner_id,
    owner_id
  from _meetings_fixture;
  $$,
  '23514',
  null,
  'related project must resolve in organisation'
);

select lives_ok(
  $$
  insert into public.meetings (
    org_id, title, starts_at, ends_at, timezone,
    related_entity_type, related_entity_id, created_by, updated_by
  )
  select
    org_id,
    'Linked project',
    now() + interval '3 days',
    now() + interval '3 days 1 hour',
    'UTC',
    'project',
    project_id,
    owner_id,
    owner_id
  from _meetings_fixture;
  $$,
  'meeting may relate to an active project'
);

select throws_ok(
  $$
  insert into public.meetings (
    org_id, title, starts_at, ends_at, timezone,
    related_entity_type, related_entity_id, created_by, updated_by
  )
  select
    org_id,
    'Missing contact',
    now() + interval '3 days',
    now() + interval '3 days 1 hour',
    'UTC',
    'contact',
    gen_random_uuid(),
    owner_id,
    owner_id
  from _meetings_fixture;
  $$,
  '23514',
  null,
  'related contact must resolve in organisation'
);

select throws_ok(
  $$
  select private.assert_document_entity_exists(
    (select org_id from _meetings_fixture),
    'meeting',
    gen_random_uuid()
  )
  $$,
  '22023',
  null,
  'document assert rejects missing meeting'
);

select lives_ok(
  $$
  select private.assert_document_entity_exists(
    (select org_id from _meetings_fixture),
    'meeting',
    (select owner_meeting_id from _meetings_fixture)
  )
  $$,
  'document assert accepts active meeting'
);

select pg_temp.as_user((select billing_id from _meetings_fixture));
set local role authenticated;

select is(
  (
    select count(*)::integer from public.meetings
    where org_id = (select org_id from _meetings_fixture)
  ),
  0,
  'billing member sees zero meetings under RLS'
);

reset role;
select pg_temp.as_user((select member_id from _meetings_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.soft_delete_meeting(
      (select owner_meeting_id from _meetings_fixture),
      (select org_id from _meetings_fixture),
      (select owner_meeting_version from _meetings_fixture)
    )
  $$,
  '42501',
  null,
  'member cannot soft-delete owner meeting'
);

select lives_ok(
  $$
    select public.soft_delete_meeting(
      (select member_meeting_id from _meetings_fixture),
      (select org_id from _meetings_fixture),
      (select member_meeting_version from _meetings_fixture)
    )
  $$,
  'member can soft-delete their own meeting'
);

reset role;
select pg_temp.as_user((select owner_id from _meetings_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.soft_delete_meeting(
      (select owner_meeting_id from _meetings_fixture),
      (select org_id from _meetings_fixture),
      (select owner_meeting_version from _meetings_fixture)
    )
  $$,
  'owner can soft-delete a meeting with matching version'
);

select is(
  (
    select count(*)::integer from public.meetings
    where id = (select owner_meeting_id from _meetings_fixture)
  ),
  0,
  'soft-deleted meeting is hidden by RLS'
);

select finish();
rollback;

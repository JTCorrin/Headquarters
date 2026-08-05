begin;

select plan(8);

select ok(
  has_function_privilege(
    'authenticated',
    'public.replace_meeting_attendees(uuid, uuid, jsonb, uuid)',
    'execute'
  ),
  'authenticated users can execute replace_meeting_attendees'
);

create temporary table _replace_attendees_fixture (
  owner_id uuid,
  member_id uuid,
  org_id uuid,
  owner_meeting_id uuid,
  member_meeting_id uuid
) on commit drop;

grant all on table _replace_attendees_fixture to authenticated;

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
    extensions.crypt('meetings-replace-password', extensions.gen_salt('bf')),
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

insert into _replace_attendees_fixture (owner_id, member_id)
values (
  pg_temp.make_auth_user('replace-attendees-owner@example.test', 'Replace Owner'),
  pg_temp.make_auth_user('replace-attendees-member@example.test', 'Replace Member')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency, timezone)
  values (
    'Replace Attendees Org',
    'replace-att-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP',
    'UTC'
  )
  returning id
)
update _replace_attendees_fixture
set org_id = created_org.id
from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _replace_attendees_fixture;
insert into public.memberships (org_id, user_id, role, status)
select org_id, member_id, 'member', 'active' from _replace_attendees_fixture;

with owner_meeting as (
  insert into public.meetings (
    org_id, title, starts_at, ends_at, timezone, created_by, updated_by
  )
  select
    org_id,
    'Owner replace meeting',
    now() + interval '1 day',
    now() + interval '1 day 1 hour',
    'UTC',
    owner_id,
    owner_id
  from _replace_attendees_fixture
  returning id
)
update _replace_attendees_fixture
set owner_meeting_id = owner_meeting.id
from owner_meeting;

with member_meeting as (
  insert into public.meetings (
    org_id, title, starts_at, ends_at, timezone, created_by, updated_by
  )
  select
    org_id,
    'Member replace meeting',
    now() + interval '2 days',
    now() + interval '2 days 30 minutes',
    'UTC',
    member_id,
    member_id
  from _replace_attendees_fixture
  returning id
)
update _replace_attendees_fixture
set member_meeting_id = member_meeting.id
from member_meeting;

insert into public.meeting_attendees (
  org_id, meeting_id, email, name, organiser, created_by, updated_by
)
select
  org_id,
  owner_meeting_id,
  'seed@replace.test',
  'Seed',
  true,
  owner_id,
  owner_id
from _replace_attendees_fixture;

select pg_temp.as_user((select owner_id from _replace_attendees_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.replace_meeting_attendees(
      (select owner_meeting_id from _replace_attendees_fixture),
      (select org_id from _replace_attendees_fixture),
      '[{"email":"only@replace.test","organiser":true}]'::jsonb
    )
  $$,
  'owner can replace meeting attendees'
);

select is(
  (
    select count(*)::integer
    from public.meeting_attendees
    where meeting_id = (select owner_meeting_id from _replace_attendees_fixture)
      and deleted_at is null
  ),
  1,
  'replace-all leaves a single live attendee'
);

select is(
  (
    select email::text
    from public.meeting_attendees
    where meeting_id = (select owner_meeting_id from _replace_attendees_fixture)
      and deleted_at is null
  ),
  'only@replace.test',
  'replace-all inserts the new attendee email'
);

select lives_ok(
  $$
    select public.replace_meeting_attendees(
      (select owner_meeting_id from _replace_attendees_fixture),
      (select org_id from _replace_attendees_fixture),
      '[]'::jsonb
    )
  $$,
  'owner can replace attendees with an empty set'
);

select is(
  (
    select count(*)::integer
    from public.meeting_attendees
    where meeting_id = (select owner_meeting_id from _replace_attendees_fixture)
      and deleted_at is null
  ),
  0,
  'empty replace soft-deletes all live attendees'
);

reset role;
select pg_temp.as_user((select member_id from _replace_attendees_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.replace_meeting_attendees(
      (select owner_meeting_id from _replace_attendees_fixture),
      (select org_id from _replace_attendees_fixture),
      '[{"email":"member@replace.test"}]'::jsonb
    )
  $$,
  '42501',
  null,
  'member cannot replace attendees on owner meeting'
);

select lives_ok(
  $$
    select public.replace_meeting_attendees(
      (select member_meeting_id from _replace_attendees_fixture),
      (select org_id from _replace_attendees_fixture),
      '[{"email":"member-own@replace.test","organiser":true}]'::jsonb
    )
  $$,
  'member can replace attendees on their own meeting'
);

select finish();
rollback;

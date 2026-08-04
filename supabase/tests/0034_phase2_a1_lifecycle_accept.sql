begin;

select plan(10);

select ok(
  has_function_privilege(
    'authenticated',
    'public.recurring_schedule_lifecycle_idempotent(text, uuid, uuid, integer, text, text, text, integer)',
    'execute'
  ),
  'authenticated can execute recurring_schedule_lifecycle_idempotent'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.accept_meeting_task_proposal(uuid, uuid, uuid)',
    'execute'
  ),
  'authenticated can execute accept_meeting_task_proposal'
);

create temporary table _a1_fixture (
  owner_id uuid,
  member_id uuid,
  org_id uuid,
  client_id uuid,
  schedule_id uuid,
  schedule_version integer,
  meeting_id uuid,
  proposal_id uuid,
  accepted_task_id uuid,
  first_body jsonb,
  replay_body jsonb
) on commit drop;

grant all on table _a1_fixture to authenticated;

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
    extensions.crypt('a1-test-password', extensions.gen_salt('bf')),
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

insert into _a1_fixture (owner_id, member_id)
values (
  pg_temp.make_auth_user('a1-owner@example.test', 'A1 Owner'),
  pg_temp.make_auth_user('a1-member@example.test', 'A1 Member')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency, timezone)
  values (
    'A1 Phase2 Org',
    'a1-phase2-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP',
    'UTC'
  )
  returning id
)
update _a1_fixture
set org_id = created_org.id
from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _a1_fixture;
insert into public.memberships (org_id, user_id, role, status)
select org_id, member_id, 'member', 'active' from _a1_fixture;

with created_client as (
  insert into public.clients (org_id, name, status, created_by, updated_by)
  select org_id, 'A1 Client', 'active', owner_id, owner_id from _a1_fixture
  returning id
)
update _a1_fixture
set client_id = created_client.id
from created_client;

select pg_temp.as_user((select owner_id from _a1_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.create_recurring_schedule_draft(
      (select org_id from _a1_fixture),
      jsonb_build_object(
        'name', 'A1 Monthly',
        'client_id', (select client_id from _a1_fixture),
        'frequency', 'monthly',
        'day_of_month', 1,
        'start_on', '2026-08-01',
        'anchor_on', '2026-08-01',
        'timezone', 'UTC',
        'local_run_time', '09:00:00'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'description_template', 'Retainer',
          'quantity', 1,
          'unit_price_cents', 10000,
          'tax_rate_percent', 20,
          'position', 1
        )
      )
    )
  $$,
  'owner can create draft schedule for lifecycle idempotency'
);

update _a1_fixture
set
  schedule_id = schedules.id,
  schedule_version = schedules.version
from public.recurring_invoice_schedules schedules
where schedules.org_id = _a1_fixture.org_id
  and schedules.name = 'A1 Monthly'
  and schedules.deleted_at is null;

with activated as (
  select public.recurring_schedule_lifecycle_idempotent(
    'activate',
    (select schedule_id from _a1_fixture),
    (select org_id from _a1_fixture),
    (select schedule_version from _a1_fixture),
    repeat('c', 64),
    repeat('d', 64),
    '/api/v1/recurring-invoice-schedules/' ||
      (select schedule_id::text from _a1_fixture) || '/activate'
  ) as body
)
update _a1_fixture
set first_body = activated.body
from activated;

select is(
  (select first_body ->> 'replay' from _a1_fixture),
  'false',
  'first activate stores a non-replay response'
);

select is(
  (
    select status from public.recurring_invoice_schedules
    where id = (select schedule_id from _a1_fixture)
  ),
  'active',
  'idempotent activate moves schedule to active'
);

with replayed as (
  select public.recurring_schedule_lifecycle_idempotent(
    'activate',
    (select schedule_id from _a1_fixture),
    (select org_id from _a1_fixture),
    (select schedule_version from _a1_fixture),
    repeat('c', 64),
    repeat('d', 64),
    '/api/v1/recurring-invoice-schedules/' ||
      (select schedule_id::text from _a1_fixture) || '/activate'
  ) as body
)
update _a1_fixture
set replay_body = replayed.body
from replayed;

select is(
  (select replay_body ->> 'replay' from _a1_fixture),
  'true',
  'second activate with same Idempotency-Key replays'
);

select throws_ok(
  $$
    select public.recurring_schedule_lifecycle_idempotent(
      'activate',
      (select schedule_id from _a1_fixture),
      (select org_id from _a1_fixture),
      (select schedule_version from _a1_fixture),
      repeat('c', 64),
      repeat('e', 64),
      '/api/v1/recurring-invoice-schedules/' ||
        (select schedule_id::text from _a1_fixture) || '/activate'
    )
  $$,
  '23505',
  null,
  'same Idempotency-Key with different request hash is rejected'
);

-- Accept proposal atomic RPC
with meeting as (
  insert into public.meetings (
    org_id, title, starts_at, ends_at, timezone, created_by, updated_by
  )
  select
    org_id,
    'A1 accept meeting',
    now() + interval '1 day',
    now() + interval '1 day 1 hour',
    'UTC',
    owner_id,
    owner_id
  from _a1_fixture
  returning id
)
update _a1_fixture
set meeting_id = meeting.id
from meeting;

with proposal as (
  insert into public.meeting_task_proposals (
    org_id, meeting_id, title, description, confidence, status
  )
  select
    org_id,
    meeting_id,
    'Ship A1',
    'Atomic accept',
    0.9500,
    'proposed'
  from _a1_fixture
  returning id
)
update _a1_fixture
set proposal_id = proposal.id
from proposal;

with accepted as (
  select public.accept_meeting_task_proposal(
    (select org_id from _a1_fixture),
    (select meeting_id from _a1_fixture),
    (select proposal_id from _a1_fixture)
  ) as body
)
update _a1_fixture
set accepted_task_id = (accepted.body ->> 'accepted_task_id')::uuid
from accepted;

select is(
  (
    select status from public.meeting_task_proposals
    where id = (select proposal_id from _a1_fixture)
  ),
  'accepted',
  'accept_meeting_task_proposal marks proposal accepted'
);

select is(
  (
    select source from public.tasks
    where id = (select accepted_task_id from _a1_fixture)
  ),
  'meeting',
  'accept_meeting_task_proposal creates meeting-sourced task'
);

select throws_ok(
  $$
    select public.accept_meeting_task_proposal(
      (select org_id from _a1_fixture),
      (select meeting_id from _a1_fixture),
      (select proposal_id from _a1_fixture)
    )
  $$,
  'P0001',
  null,
  're-accepting a decided proposal conflicts'
);

select * from finish();
rollback;

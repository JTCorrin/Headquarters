begin;

select plan(11);

select has_table('public', 'recurring_invoice_schedules', 'schedules table exists');
select has_table('public', 'recurring_invoice_lines', 'lines table exists');
select has_table('public', 'recurring_invoice_runs', 'runs table exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.recurring_invoice_schedules'::regclass),
  'schedules have RLS enabled'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_recurring_schedule_draft(uuid, jsonb, jsonb)',
    'execute'
  ),
  'authenticated can execute create_recurring_schedule_draft'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.run_now_recurring_schedule(uuid, uuid, integer, text, text, text, integer)',
    'execute'
  ),
  'authenticated can execute run_now_recurring_schedule'
);

create temporary table _rec_fixture (
  owner_id uuid,
  outsider_id uuid,
  org_id uuid,
  other_org_id uuid,
  client_id uuid,
  schedule_id uuid,
  schedule_version integer,
  empty_schedule_id uuid,
  empty_schedule_version integer,
  invoice_id uuid
) on commit drop;

grant all on table _rec_fixture to authenticated;

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
    extensions.crypt('recurring-test-password', extensions.gen_salt('bf')),
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

insert into _rec_fixture (owner_id, outsider_id)
values (
  pg_temp.make_auth_user('recurring-owner@example.test', 'Recurring Owner'),
  pg_temp.make_auth_user('recurring-outsider@example.test', 'Recurring Outsider')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Recurring Org',
    'recurring-org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
),
other_org as (
  insert into public.organisations (name, slug, country_code)
  values (
    'Other Rec Org',
    'other-rec-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB'
  )
  returning id
)
update _rec_fixture
set org_id = created_org.id, other_org_id = other_org.id
from created_org, other_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _rec_fixture;
insert into public.memberships (org_id, user_id, role, status)
select other_org_id, outsider_id, 'owner', 'active' from _rec_fixture;

with created_client as (
  insert into public.clients (org_id, name, status, created_by, updated_by)
  select org_id, 'Recurring Client', 'active', owner_id, owner_id
  from _rec_fixture
  returning id
)
update _rec_fixture
set client_id = created_client.id
from created_client;

select pg_temp.as_user((select owner_id from _rec_fixture));
set local role authenticated;

with empty_created as (
  select public.create_recurring_schedule_draft(
    (select org_id from _rec_fixture),
    jsonb_build_object(
      'name', 'Empty lines',
      'client_id', (select client_id from _rec_fixture),
      'frequency', 'monthly',
      'day_of_month', 1,
      'start_on', '2026-08-01',
      'anchor_on', '2026-08-01'
    ),
    '[]'::jsonb
  ) as doc
)
update _rec_fixture
set
  empty_schedule_id = (empty_created.doc -> 'schedule' ->> 'id')::uuid,
  empty_schedule_version = (empty_created.doc -> 'schedule' ->> 'version')::integer
from empty_created;

select throws_ok(
  $$
    select public.activate_recurring_schedule(
      (select empty_schedule_id from _rec_fixture),
      (select org_id from _rec_fixture),
      (select empty_schedule_version from _rec_fixture)
    )
  $$,
  '22023',
  null,
  'activate without lines is rejected'
);

with created as (
  select public.create_recurring_schedule_draft(
    (select org_id from _rec_fixture),
    jsonb_build_object(
      'name', 'Monthly retainer',
      'client_id', (select client_id from _rec_fixture),
      'frequency', 'monthly',
      'day_of_month', 1,
      'start_on', '2026-08-01',
      'anchor_on', '2026-08-01',
      'timezone', 'UTC',
      'local_run_time', '09:00:00'
    ),
    jsonb_build_array(
      jsonb_build_object(
        'description_template', 'Retainer {{period_start}} to {{period_end}}',
        'quantity', 1,
        'unit_price_cents', 420000,
        'tax_rate_percent', 20,
        'position', 1
      )
    )
  ) as doc
)
update _rec_fixture
set
  schedule_id = (created.doc -> 'schedule' ->> 'id')::uuid,
  schedule_version = (created.doc -> 'schedule' ->> 'version')::integer
from created;

with activated as (
  select public.activate_recurring_schedule(
    (select schedule_id from _rec_fixture),
    (select org_id from _rec_fixture),
    (select schedule_version from _rec_fixture)
  ) as doc
)
update _rec_fixture
set schedule_version = (activated.doc -> 'schedule' ->> 'version')::integer
from activated;

select is(
  (
    select status from public.recurring_invoice_schedules
    where id = (select schedule_id from _rec_fixture)
  ),
  'active',
  'activate moves schedule to active'
);

select ok(
  (
    select next_run_at is not null from public.recurring_invoice_schedules
    where id = (select schedule_id from _rec_fixture)
  ),
  'activate sets next_run_at'
);

with ran as (
  select public.run_now_recurring_schedule(
    (select schedule_id from _rec_fixture),
    (select org_id from _rec_fixture),
    (select schedule_version from _rec_fixture),
    repeat('a', 64),
    repeat('b', 64),
    '/api/v1/recurring-invoice-schedules/' || (select schedule_id::text from _rec_fixture) || '/run-now'
  ) as doc
)
update _rec_fixture
set invoice_id = (ran.doc -> 'response_body' -> 'data' -> 'invoice' ->> 'id')::uuid
from ran;

select is(
  (select source from public.invoices where id = (select invoice_id from _rec_fixture)),
  'recurring',
  'run-now invoice source is recurring'
);

select ok(
  exists (
    select 1
    from public.invoices i
    join public.recurring_invoice_runs r on r.id = i.recurring_run_id
    where i.id = (select invoice_id from _rec_fixture)
      and r.schedule_id = (select schedule_id from _rec_fixture)
      and r.trigger = 'manual'
  ),
  'invoice links to manual recurring run'
);

reset role;
select pg_temp.as_user((select outsider_id from _rec_fixture));
set local role authenticated;

select is(
  (
    select count(*)::integer from public.recurring_invoice_schedules
    where id = (select schedule_id from _rec_fixture)
  ),
  0,
  'outsider cannot select schedule under RLS'
);

select finish();
rollback;

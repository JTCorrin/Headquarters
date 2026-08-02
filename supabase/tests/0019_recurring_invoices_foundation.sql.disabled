begin;

select plan(16);

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

select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'invoices_recurring_run_fk'
  ),
  'invoices.recurring_run_id FK to runs exists'
);

create temporary table _rec_fixture (
  owner_id uuid,
  outsider_id uuid,
  org_id uuid,
  other_org_id uuid,
  client_id uuid,
  empty_schedule_id uuid,
  empty_schedule_version integer,
  schedule_id uuid,
  schedule_version integer,
  invoice_id uuid,
  run_id uuid
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

select lives_ok(
  $$
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
    )
  $$,
  'owner can create a draft schedule with zero lines'
);

update _rec_fixture
set
  empty_schedule_id = schedules.id,
  empty_schedule_version = schedules.version
from public.recurring_invoice_schedules schedules
where schedules.org_id = _rec_fixture.org_id
  and schedules.name = 'Empty lines'
  and schedules.deleted_at is null;

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

select lives_ok(
  $$
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
    )
  $$,
  'owner can create a draft schedule with a line'
);

update _rec_fixture
set
  schedule_id = schedules.id,
  schedule_version = schedules.version
from public.recurring_invoice_schedules schedules
where schedules.org_id = _rec_fixture.org_id
  and schedules.name = 'Monthly retainer'
  and schedules.deleted_at is null;

select lives_ok(
  $$
    select public.activate_recurring_schedule(
      (select schedule_id from _rec_fixture),
      (select org_id from _rec_fixture),
      (select schedule_version from _rec_fixture)
    )
  $$,
  'owner can activate a schedule with lines'
);

update _rec_fixture
set schedule_version = schedules.version
from public.recurring_invoice_schedules schedules
where schedules.id = _rec_fixture.schedule_id;

select is(
  (
    select status from public.recurring_invoice_schedules
    where id = (select schedule_id from _rec_fixture)
  ),
  'active',
  'activate moves schedule to active'
);

select lives_ok(
  $$
    select public.run_now_recurring_schedule(
      (select schedule_id from _rec_fixture),
      (select org_id from _rec_fixture),
      (select schedule_version from _rec_fixture),
      repeat('a', 64),
      repeat('b', 64),
      '/api/v1/recurring-invoice-schedules/' ||
        (select schedule_id::text from _rec_fixture) || '/run-now'
    )
  $$,
  'owner can run-now a schedule into a draft invoice'
);

update _rec_fixture
set
  invoice_id = invoices.id,
  run_id = invoices.recurring_run_id
from public.invoices
where invoices.org_id = _rec_fixture.org_id
  and invoices.source = 'recurring'
  and invoices.deleted_at is null;

select is(
  (select source from public.invoices where id = (select invoice_id from _rec_fixture)),
  'recurring',
  'run-now invoice source is recurring'
);

select ok(
  (
    select recurring_run_id is not null
      and recurring_run_id = (select run_id from _rec_fixture)
    from public.invoices
    where id = (select invoice_id from _rec_fixture)
  ),
  'invoice links recurring_run_id'
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

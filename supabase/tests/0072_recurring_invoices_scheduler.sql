begin;

select plan(7);

select ok(
  has_function_privilege(
    'service_role',
    'public.process_due_recurring_schedules(integer, text)',
    'execute'
  ),
  'service_role can execute process_due_recurring_schedules'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.process_due_recurring_schedules(integer, text)',
    'execute'
  ),
  'authenticated cannot execute process_due_recurring_schedules'
);

create temporary table _sched_cron_fixture (
  owner_id uuid,
  org_id uuid,
  client_id uuid,
  schedule_id uuid,
  schedule_version integer,
  run_id uuid,
  invoice_id uuid
) on commit drop;

grant all on table _sched_cron_fixture to authenticated;
grant all on table _sched_cron_fixture to service_role;

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
    extensions.crypt('sched-cron-password', extensions.gen_salt('bf')),
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

insert into _sched_cron_fixture (owner_id)
values (pg_temp.make_auth_user('sched-cron-owner@example.test', 'Sched Cron Owner'));

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Sched Cron Org',
    'sched-cron-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
)
update _sched_cron_fixture
set org_id = created_org.id
from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _sched_cron_fixture;

with created_client as (
  insert into public.clients (org_id, name, status, created_by, updated_by)
  select org_id, 'Sched Cron Client', 'active', owner_id, owner_id
  from _sched_cron_fixture
  returning id
)
update _sched_cron_fixture
set client_id = created_client.id
from created_client;

select pg_temp.as_user((select owner_id from _sched_cron_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.create_recurring_schedule_draft(
      (select org_id from _sched_cron_fixture),
      jsonb_build_object(
        'name', 'Daily cron retainer',
        'client_id', (select client_id from _sched_cron_fixture),
        'frequency', 'daily',
        'start_on', (current_date - 2)::text,
        'anchor_on', (current_date - 2)::text,
        'timezone', 'UTC',
        'local_run_time', '00:00:00'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'description_template', 'Daily {{period_start}}',
          'quantity', 1,
          'unit_price_cents', 1000,
          'tax_rate_percent', 0,
          'position', 1
        )
      )
    )
  $$,
  'owner can create daily schedule for cron test'
);

update _sched_cron_fixture
set
  schedule_id = schedules.id,
  schedule_version = schedules.version
from public.recurring_invoice_schedules schedules
where schedules.org_id = _sched_cron_fixture.org_id
  and schedules.name = 'Daily cron retainer'
  and schedules.deleted_at is null;

select lives_ok(
  $$
    select public.activate_recurring_schedule(
      (select schedule_id from _sched_cron_fixture),
      (select org_id from _sched_cron_fixture),
      (select schedule_version from _sched_cron_fixture)
    )
  $$,
  'owner can activate daily schedule'
);

reset role;

-- Make the schedule due now (activate computes a future next_run_at).
update public.recurring_invoice_schedules
set next_run_at = now() - interval '1 minute'
where id = (select schedule_id from _sched_cron_fixture);

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config(
  'request.jwt.claims',
  json_build_object('role', 'service_role')::text,
  true
);

select is(
  (
    select (public.process_due_recurring_schedules(20, 'pgTAP-cron') ->> 'generated')::integer
  ),
  1,
  'cron processor generates one draft invoice for a due schedule'
);

update _sched_cron_fixture
set
  run_id = runs.id,
  invoice_id = invoices.id
from public.recurring_invoice_runs runs
join public.invoices on invoices.recurring_run_id = runs.id
where runs.schedule_id = _sched_cron_fixture.schedule_id
  and runs.trigger = 'scheduled';

select is(
  (
    select trigger from public.recurring_invoice_runs
    where id = (select run_id from _sched_cron_fixture)
  ),
  'scheduled',
  'cron run trigger is scheduled'
);

select is(
  (
    select source from public.invoices
    where id = (select invoice_id from _sched_cron_fixture)
  ),
  'recurring',
  'cron invoice source is recurring'
);

select * from finish();
rollback;

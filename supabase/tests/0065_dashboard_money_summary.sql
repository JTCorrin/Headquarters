begin;

select plan(11);

select ok(
  has_function_privilege(
    'authenticated',
    'public.dashboard_money_summary(uuid)',
    'execute'
  ),
  'authenticated can execute dashboard_money_summary'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.dashboard_money_summary(uuid)',
    'execute'
  ),
  'anon cannot execute dashboard_money_summary'
);

create temporary table _dash_fixture (
  owner_id uuid,
  billing_id uuid,
  outsider_id uuid,
  org_id uuid,
  other_org_id uuid,
  owner_membership_id uuid,
  client_id uuid,
  invoice_id uuid,
  invoice_version integer,
  quote_id uuid,
  quote_version integer
) on commit drop;

grant all on table _dash_fixture to authenticated;

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
    extensions.crypt('dash-summary-password', extensions.gen_salt('bf')),
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

insert into _dash_fixture (owner_id, billing_id, outsider_id)
values (
  pg_temp.make_auth_user('dash-owner@example.test', 'Dash Owner'),
  pg_temp.make_auth_user('dash-billing@example.test', 'Dash Billing'),
  pg_temp.make_auth_user('dash-outsider@example.test', 'Dash Outsider')
);

with created as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values ('Dash Org', 'dash-org-' || substr(gen_random_uuid()::text, 1, 8), 'GB', 'GBP')
  returning id
)
update _dash_fixture set org_id = created.id from created;

with created as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values ('Other Dash Org', 'other-dash-' || substr(gen_random_uuid()::text, 1, 8), 'GB', 'GBP')
  returning id
)
update _dash_fixture set other_org_id = created.id from created;

insert into public.document_sequences (org_id, document_type, prefix, next_number, padding)
select org_id, 'invoice', 'INV-', 1, 4 from _dash_fixture;

insert into public.document_sequences (org_id, document_type, prefix, next_number, padding)
select org_id, 'quote', 'Q-', 1, 4 from _dash_fixture;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _dash_fixture;

insert into public.memberships (org_id, user_id, role, status)
select org_id, billing_id, 'billing', 'active' from _dash_fixture;

insert into public.memberships (org_id, user_id, role, status)
select other_org_id, outsider_id, 'owner', 'active' from _dash_fixture;

update _dash_fixture
set owner_membership_id = (
  select memberships.id
  from public.memberships
  join _dash_fixture f
    on f.org_id = memberships.org_id
   and f.owner_id = memberships.user_id
);

with created as (
  insert into public.clients (org_id, name, status, primary_email)
  select org_id, 'Acme Client', 'active', 'ap@acme.test' from _dash_fixture
  returning id
)
update _dash_fixture set client_id = created.id from created;

select pg_temp.as_user((select owner_id from _dash_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.create_invoice_draft(
      (select org_id from _dash_fixture),
      jsonb_build_object(
        'client_id', (select client_id from _dash_fixture),
        'currency', 'GBP',
        'issue_on', (timezone('utc', now()))::date - 20,
        'due_on', (timezone('utc', now()))::date - 15,
        'discount_cents', 0
      ),
      jsonb_build_array(
        jsonb_build_object(
          'description', 'Overdue work',
          'quantity', 1,
          'unit_price_cents', 10000,
          'tax_rate_percent', 0,
          'position', 0
        )
      )
    )
  $$,
  'owner can create overdue draft invoice for dashboard fixture'
);

update _dash_fixture
set
  invoice_id = invoices.id,
  invoice_version = invoices.version
from public.invoices
where invoices.org_id = _dash_fixture.org_id
  and invoices.deleted_at is null;

select lives_ok(
  $$
    select public.send_invoice(
      (select invoice_id from _dash_fixture),
      (select org_id from _dash_fixture),
      (select invoice_version from _dash_fixture)
    )
  $$,
  'owner can send overdue invoice'
);

update _dash_fixture
set invoice_version = invoices.version
from public.invoices
where invoices.id = _dash_fixture.invoice_id;

select lives_ok(
  $$
    select public.create_payment(
      (select org_id from _dash_fixture),
      jsonb_build_object(
        'direction', 'inbound',
        'client_id', (select client_id from _dash_fixture),
        'amount_cents', 2500,
        'currency', 'GBP',
        'method', 'bank',
        'provider', 'manual',
        'occurred_on', (timezone('utc', now()))::date
      ),
      jsonb_build_array(
        jsonb_build_object(
          'invoice_id', (select invoice_id from _dash_fixture),
          'amount_cents', 2500
        )
      )
    )
  $$,
  'owner can record inbound payment for cash KPI'
);

select lives_ok(
  $$
    select public.create_quote_draft(
      (select org_id from _dash_fixture),
      jsonb_build_object(
        'title', 'Awaiting reply',
        'client_id', (select client_id from _dash_fixture),
        'currency', 'GBP',
        'valid_until', (timezone('utc', now()))::date + 5,
        'discount_cents', 0
      ),
      jsonb_build_array(
        jsonb_build_object(
          'description', 'Proposal line',
          'quantity', 1,
          'unit_price_cents', 50000,
          'tax_rate_percent', 0,
          'position', 0
        )
      )
    )
  $$,
  'owner can create quote for pipeline fixture'
);

update _dash_fixture
set
  quote_id = quotes.id,
  quote_version = quotes.version
from public.quotes
where quotes.org_id = _dash_fixture.org_id
  and quotes.title = 'Awaiting reply'
  and quotes.deleted_at is null;

select lives_ok(
  $$
    select public.send_quote(
      (select quote_id from _dash_fixture),
      (select org_id from _dash_fixture),
      (select quote_version from _dash_fixture)
    )
  $$,
  'owner can send quote for awaiting chase list'
);

select ok(
  (
    select
      (summary ->> 'currency') = 'GBP'
      and (summary -> 'kpis' ->> 'outstanding_cents')::bigint = 7500
      and (summary -> 'kpis' ->> 'overdue_cents')::bigint = 7500
      and (summary -> 'kpis' ->> 'overdue_invoice_count')::integer = 1
      and (summary -> 'kpis' ->> 'cash_collected_30d_cents')::bigint = 2500
      and (summary -> 'kpis' ->> 'booked_30d_cents')::bigint = 10000
      and jsonb_array_length(summary -> 'aging') = 5
      and jsonb_array_length(summary -> 'monthly') = 6
      and jsonb_array_length(summary -> 'quote_pipeline') = 4
      and jsonb_array_length(summary -> 'chase' -> 'overdue_invoices') = 1
      and jsonb_array_length(summary -> 'chase' -> 'awaiting_quotes') = 1
      and jsonb_array_length(summary -> 'chase' -> 'expiring_quotes') = 1
    from public.dashboard_money_summary((select org_id from _dash_fixture)) as summary
  ),
  'owner summary returns KPIs, aging, monthly, pipeline, and chase lists'
);

select ok(
  (
    select
      (bucket ->> 'bucket') = '1_30'
      and (bucket ->> 'cents')::bigint = 7500
      and (bucket ->> 'count')::integer = 1
    from jsonb_array_elements(
      public.dashboard_money_summary((select org_id from _dash_fixture)) -> 'aging'
    ) as bucket
    where bucket ->> 'bucket' = '1_30'
  ),
  'overdue invoice lands in the 1_30 aging bucket'
);

reset role;
select pg_temp.as_user((select billing_id from _dash_fixture));
set local role authenticated;

select ok(
  (
    select
      (summary -> 'kpis' ->> 'outstanding_cents')::bigint = 7500
      and jsonb_array_length(summary -> 'quote_pipeline') = 0
      and jsonb_array_length(summary -> 'chase' -> 'awaiting_quotes') = 0
      and jsonb_array_length(summary -> 'chase' -> 'expiring_quotes') = 0
    from public.dashboard_money_summary((select org_id from _dash_fixture)) as summary
  ),
  'billing can read money KPIs but gets empty quote sections'
);

reset role;
select pg_temp.as_user((select outsider_id from _dash_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.dashboard_money_summary((select org_id from _dash_fixture))
  $$,
  '42501',
  'Forbidden',
  'foreign-org member cannot read dashboard summary'
);

select * from finish();
rollback;

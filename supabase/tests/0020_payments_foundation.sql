begin;

select plan(30);

select has_table('public', 'payments', 'payments table exists');
select has_table('public', 'payment_allocations', 'payment_allocations table exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.payments'::regclass),
  'payments have row level security enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.payment_allocations'::regclass),
  'payment_allocations have row level security enabled'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_payment(uuid, jsonb, jsonb)',
    'execute'
  ),
  'authenticated can execute create_payment'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.allocate_payment(uuid, uuid, integer, jsonb)',
    'execute'
  ),
  'authenticated can execute allocate_payment'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.reverse_payment(uuid, uuid, integer, text)',
    'execute'
  ),
  'authenticated can execute reverse_payment'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.get_payment(uuid, uuid)',
    'execute'
  ),
  'authenticated can execute get_payment'
);

create temporary table _pay_fixture (
  owner_id uuid,
  billing_id uuid,
  outsider_id uuid,
  org_id uuid,
  other_org_id uuid,
  client_id uuid,
  vendor_id uuid,
  contact_id uuid,
  product_id uuid,
  tax_rate_id uuid,
  invoice_id uuid,
  invoice_version integer,
  invoice_total bigint,
  bill_id uuid,
  bill_version integer,
  bill_total bigint,
  payment_id uuid,
  payment_version integer
) on commit drop;

grant all on table _pay_fixture to authenticated;

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
    extensions.crypt('payments-test-password', extensions.gen_salt('bf')),
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

insert into _pay_fixture (owner_id, billing_id, outsider_id)
values (
  pg_temp.make_auth_user('payments-owner@example.test', 'Payments Owner'),
  pg_temp.make_auth_user('payments-billing@example.test', 'Payments Billing'),
  pg_temp.make_auth_user('payments-outsider@example.test', 'Payments Outsider')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Payments Org',
    'payments-org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
),
other_org as (
  insert into public.organisations (name, slug, country_code)
  values (
    'Other Payments Org',
    'other-payments-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB'
  )
  returning id
)
update _pay_fixture
set
  org_id = created_org.id,
  other_org_id = other_org.id
from created_org, other_org;

insert into public.document_sequences (org_id, document_type, prefix, next_number, padding)
select org_id, 'invoice', 'INV-', 1, 4 from _pay_fixture
on conflict do nothing;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _pay_fixture;

insert into public.memberships (org_id, user_id, role, status)
select org_id, billing_id, 'billing', 'active' from _pay_fixture;

insert into public.memberships (org_id, user_id, role, status)
select other_org_id, outsider_id, 'owner', 'active' from _pay_fixture;

with created_tax as (
  insert into public.tax_rates (org_id, name, rate_percent, is_default, active)
  select org_id, 'VAT 20%', 20, true, true from _pay_fixture
  returning id
)
update _pay_fixture set tax_rate_id = created_tax.id from created_tax;

with created_product as (
  insert into public.products (
    org_id, sku, name, product_type, unit_price_cents, currency,
    tax_rate_id, track_stock, status
  )
  select
    org_id, 'PAY-SVC', 'Payment test service', 'service', 10000, 'GBP',
    tax_rate_id, false, 'active'
  from _pay_fixture
  returning id
)
update _pay_fixture set product_id = created_product.id from created_product;

with created_client as (
  insert into public.clients (org_id, name, status, primary_email)
  select org_id, 'Pay Client', 'active', 'ap@pay.test' from _pay_fixture
  returning id
)
update _pay_fixture set client_id = created_client.id from created_client;

with created_contact as (
  insert into public.contacts (org_id, display_name, primary_email)
  select org_id, 'Pay Contact', 'pay@pay.test' from _pay_fixture
  returning id
)
update _pay_fixture set contact_id = created_contact.id from created_contact;

with created_vendor as (
  insert into public.vendors (org_id, name, status, primary_email)
  select org_id, 'Pay Vendor', 'active', 'vendor@pay.test' from _pay_fixture
  returning id
)
update _pay_fixture set vendor_id = created_vendor.id from created_vendor;

select pg_temp.as_user((select owner_id from _pay_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.create_invoice_draft(
      (select org_id from _pay_fixture),
      jsonb_build_object(
        'client_id', (select client_id from _pay_fixture),
        'contact_id', (select contact_id from _pay_fixture)
      ),
      jsonb_build_array(
        jsonb_build_object(
          'product_id', (select product_id from _pay_fixture),
          'quantity', 1,
          'position', 0
        )
      )
    )
  $$,
  'owner can create invoice draft for payments tests'
);

update _pay_fixture
set
  invoice_id = invoices.id,
  invoice_version = invoices.version,
  invoice_total = invoices.total_cents
from public.invoices
where invoices.org_id = _pay_fixture.org_id
  and invoices.deleted_at is null;

select lives_ok(
  $$
    select public.send_invoice(
      (select invoice_id from _pay_fixture),
      (select org_id from _pay_fixture),
      (select invoice_version from _pay_fixture)
    )
  $$,
  'owner can send invoice so it accepts allocations'
);

update _pay_fixture
set invoice_version = invoices.version
from public.invoices
where invoices.id = (select invoice_id from _pay_fixture);

select lives_ok(
  $$
    select public.create_bill_draft(
      (select org_id from _pay_fixture),
      jsonb_build_object(
        'vendor_id', (select vendor_id from _pay_fixture),
        'number', 'PAY-BILL-1',
        'currency', 'GBP',
        'due_on', (current_date + 30)::text
      ),
      jsonb_build_array(
        jsonb_build_object(
          'description', 'Supplies',
          'quantity', 1,
          'unit_price_cents', 5000,
          'tax_rate_percent', 20,
          'position', 0
        )
      )
    )
  $$,
  'owner can create bill draft for payments tests'
);

update _pay_fixture
set
  bill_id = bills.id,
  bill_version = bills.version,
  bill_total = bills.total_cents
from public.bills
where bills.org_id = (select org_id from _pay_fixture)
  and bills.number = 'PAY-BILL-1'
  and bills.deleted_at is null;

select lives_ok(
  $$
    select public.receive_bill(
      (select bill_id from _pay_fixture),
      (select org_id from _pay_fixture),
      (select bill_version from _pay_fixture)
    )
  $$,
  'owner can receive bill so it accepts allocations'
);

update _pay_fixture
set bill_version = bills.version
from public.bills
where bills.id = (select bill_id from _pay_fixture);

-- Partial inbound payment against sent invoice
select lives_ok(
  $$
    select public.create_payment(
      (select org_id from _pay_fixture),
      jsonb_build_object(
        'direction', 'inbound',
        'client_id', (select client_id from _pay_fixture),
        'amount_cents', 5000,
        'currency', 'GBP',
        'method', 'bank',
        'provider', 'manual'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'invoice_id', (select invoice_id from _pay_fixture),
          'amount_cents', 5000
        )
      )
    )
  $$,
  'owner can create inbound payment with invoice allocation'
);

update _pay_fixture
set
  payment_id = latest.id,
  payment_version = latest.version
from (
  select id, version
  from public.payments
  where org_id = (select org_id from _pay_fixture)
    and direction = 'inbound'
    and reverses_payment_id is null
  order by created_at desc
  limit 1
) as latest;

select is(
  (select status from public.payments where id = (select payment_id from _pay_fixture)),
  'completed',
  'fully allocated inbound payment is completed'
);

select is(
  (select status from public.invoices where id = (select invoice_id from _pay_fixture)),
  'partial',
  'partial invoice allocation drives invoice to partial'
);

select is(
  (select paid_cents from public.invoices where id = (select invoice_id from _pay_fixture)),
  5000::bigint,
  'invoice paid_cents reflects allocation'
);

select throws_ok(
  $$
    select pg_temp.as_user(owner_id) from _pay_fixture;
    select public.create_payment(
      (select org_id from _pay_fixture),
      jsonb_build_object(
        'direction', 'inbound',
        'client_id', (select client_id from _pay_fixture),
        'amount_cents', 999999,
        'currency', 'GBP',
        'method', 'bank'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'invoice_id', (select invoice_id from _pay_fixture),
          'amount_cents', 999999
        )
      )
    )
  $$,
  '22023',
  'Allocation exceeds invoice balance due',
  'over-allocate against invoice balance is rejected'
);

select throws_ok(
  $$
    select pg_temp.as_user(owner_id) from _pay_fixture;
    select public.create_payment(
      (select org_id from _pay_fixture),
      jsonb_build_object(
        'direction', 'inbound',
        'client_id', (select client_id from _pay_fixture),
        'amount_cents', 100,
        'currency', 'USD',
        'method', 'bank'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'invoice_id', (select invoice_id from _pay_fixture),
          'amount_cents', 100
        )
      )
    )
  $$,
  '22023',
  'Allocation currency must match payment and invoice',
  'currency mismatch is rejected'
);

select throws_ok(
  $$
    select pg_temp.as_user(billing_id) from _pay_fixture;
    select public.create_payment(
      (select org_id from _pay_fixture),
      jsonb_build_object(
        'direction', 'inbound',
        'client_id', (select client_id from _pay_fixture),
        'amount_cents', 100,
        'currency', 'GBP',
        'method', 'bank'
      ),
      '[]'::jsonb
    )
  $$,
  '42501',
  'This action is not permitted',
  'billing role cannot create payments'
);

select throws_ok(
  $$
    select pg_temp.as_user(outsider_id) from _pay_fixture;
    select public.create_payment(
      (select org_id from _pay_fixture),
      jsonb_build_object(
        'direction', 'inbound',
        'client_id', (select client_id from _pay_fixture),
        'amount_cents', 100,
        'currency', 'GBP',
        'method', 'bank'
      ),
      '[]'::jsonb
    )
  $$,
  '42501',
  'This action is not permitted',
  'cross-org create is denied'
);

-- Pay remaining invoice balance → paid
select lives_ok(
  $$
    select pg_temp.as_user(owner_id) from _pay_fixture;
    select public.create_payment(
      (select org_id from _pay_fixture),
      jsonb_build_object(
        'direction', 'inbound',
        'client_id', (select client_id from _pay_fixture),
        'amount_cents', (
          select balance_due_cents from public.invoices
          where id = (select invoice_id from _pay_fixture)
        ),
        'currency', 'GBP',
        'method', 'bank'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'invoice_id', (select invoice_id from _pay_fixture),
          'amount_cents', (
            select balance_due_cents from public.invoices
            where id = (select invoice_id from _pay_fixture)
          )
        )
      )
    )
  $$,
  'owner can allocate remaining invoice balance'
);

select is(
  (select status from public.invoices where id = (select invoice_id from _pay_fixture)),
  'paid',
  'full allocation drives invoice to paid'
);

select lives_ok(
  $$
    select pg_temp.as_user(owner_id) from _pay_fixture;
    select public.reverse_payment(
      (select payment_id from _pay_fixture),
      (select org_id from _pay_fixture),
      (select version from public.payments where id = (select payment_id from _pay_fixture)),
      'Test reversal'
    )
  $$,
  'owner can reverse an inbound payment'
);

select is(
  (select status from public.payments where id = (select payment_id from _pay_fixture)),
  'reversed',
  'reversed payment status is reversed'
);

select ok(
  (
    select status in ('partial', 'sent')
      and paid_cents < total_cents
    from public.invoices
    where id = (select invoice_id from _pay_fixture)
  ),
  'reversing first allocation reopens invoice balance'
);

-- Outbound → bill allocate → reverse
select lives_ok(
  $$
    select pg_temp.as_user(owner_id) from _pay_fixture;
    select public.create_payment(
      (select org_id from _pay_fixture),
      jsonb_build_object(
        'direction', 'outbound',
        'vendor_id', (select vendor_id from _pay_fixture),
        'amount_cents', (select bill_total from _pay_fixture),
        'currency', 'GBP',
        'method', 'bank'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'bill_id', (select bill_id from _pay_fixture),
          'amount_cents', (select bill_total from _pay_fixture)
        )
      )
    )
  $$,
  'owner can create outbound payment allocating a bill'
);

select is(
  (select status from public.bills where id = (select bill_id from _pay_fixture)),
  'paid',
  'full bill allocation drives bill to paid'
);

update _pay_fixture
set
  payment_id = latest.id,
  payment_version = latest.version
from (
  select id, version
  from public.payments
  where org_id = (select org_id from _pay_fixture)
    and direction = 'outbound'
    and reverses_payment_id is null
  order by created_at desc
  limit 1
) as latest;

select lives_ok(
  $$
    select pg_temp.as_user(owner_id) from _pay_fixture;
    select public.reverse_payment(
      (select payment_id from _pay_fixture),
      (select org_id from _pay_fixture),
      (select version from public.payments where id = (select payment_id from _pay_fixture)),
      'Bill payment mistake'
    )
  $$,
  'owner can reverse an outbound payment'
);

select is(
  (select status from public.bills where id = (select bill_id from _pay_fixture)),
  'received',
  'bill reverse restores status to received'
);

select is(
  (select paid_cents from public.bills where id = (select bill_id from _pay_fixture)),
  0::bigint,
  'bill reverse clears paid_cents'
);

select * from finish();
rollback;

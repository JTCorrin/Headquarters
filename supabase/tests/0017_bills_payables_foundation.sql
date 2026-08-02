begin;

select plan(42);

select has_table('public', 'vendors', 'vendors table exists');
select has_table('public', 'bills', 'bills table exists');
select has_table('public', 'bill_lines', 'bill_lines table exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.vendors'::regclass),
  'vendors have row level security enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.bills'::regclass),
  'bills have row level security enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.bill_lines'::regclass),
  'bill_lines have row level security enabled'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'bills'
      and indexname = 'bills_org_vendor_number_uidx'
  ),
  'bill numbers are unique per organisation vendor among active rows'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_bill_draft(uuid, jsonb, jsonb)',
    'execute'
  ),
  'authenticated users can execute create_bill_draft'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.receive_bill(uuid, uuid, integer)',
    'execute'
  ),
  'authenticated users can execute receive_bill'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.void_bill(uuid, uuid, integer, text)',
    'execute'
  ),
  'authenticated users can execute void_bill'
);

create temporary table _bills_fixture (
  owner_id uuid,
  billing_id uuid,
  outsider_id uuid,
  org_id uuid,
  other_org_id uuid,
  vendor_id uuid,
  other_vendor_id uuid,
  bill_id uuid,
  bill_version integer
) on commit drop;

grant all on table _bills_fixture to authenticated;

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
    extensions.crypt('bills-test-password', extensions.gen_salt('bf')),
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

insert into _bills_fixture (owner_id, billing_id, outsider_id)
values (
  pg_temp.make_auth_user('bills-owner@example.test', 'Bills Owner'),
  pg_temp.make_auth_user('bills-billing@example.test', 'Bills Billing'),
  pg_temp.make_auth_user('bills-outsider@example.test', 'Bills Outsider')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Bills Org',
    'bills-org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
),
other_org as (
  insert into public.organisations (name, slug, country_code)
  values (
    'Other Bills Org',
    'other-bills-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB'
  )
  returning id
)
update _bills_fixture
set org_id = created_org.id, other_org_id = other_org.id
from created_org, other_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _bills_fixture;
insert into public.memberships (org_id, user_id, role, status)
select org_id, billing_id, 'billing', 'active' from _bills_fixture;
insert into public.memberships (org_id, user_id, role, status)
select other_org_id, outsider_id, 'owner', 'active' from _bills_fixture;

select lives_ok(
  $$
  select pg_temp.as_user(owner_id) from _bills_fixture;
  insert into public.vendors (org_id, name, status, primary_email)
  select org_id, 'Acme Supplies', 'active', 'ap@acme-supplies.test'
  from _bills_fixture;
  $$,
  'owner can insert a vendor'
);

update _bills_fixture
set vendor_id = (
  select vendors.id from public.vendors
  join _bills_fixture f on f.org_id = vendors.org_id
  where vendors.name = 'Acme Supplies' and vendors.deleted_at is null
  limit 1
);

select lives_ok(
  $$
  select pg_temp.as_user(outsider_id) from _bills_fixture;
  insert into public.vendors (org_id, name, status)
  select other_org_id, 'Other Vendor', 'active' from _bills_fixture;
  $$,
  'outsider can insert vendor in their own org'
);

update _bills_fixture
set other_vendor_id = (
  select vendors.id from public.vendors
  join _bills_fixture f on f.other_org_id = vendors.org_id
  where vendors.name = 'Other Vendor'
  limit 1
);

select throws_ok(
  $$
  select pg_temp.as_user(owner_id) from _bills_fixture;
  insert into public.bills (
    org_id, vendor_id, number, status, currency, due_on
  )
  select org_id, vendor_id, 'DIRECT-1', 'draft', 'GBP', current_date
  from _bills_fixture;
  $$,
  '42501',
  'Bills must be created through the draft RPC',
  'direct bill insert is denied'
);

select lives_ok(
  $$
  select pg_temp.as_user(owner_id) from _bills_fixture;
  select public.create_bill_draft(
    (select org_id from _bills_fixture),
    jsonb_build_object(
      'vendor_id', (select vendor_id from _bills_fixture),
      'number', 'VENDOR-1001',
      'currency', 'GBP',
      'due_on', (current_date + 30)::text,
      'discount_cents', 100
    ),
    jsonb_build_array(
      jsonb_build_object(
        'description', 'Hosting',
        'quantity', 1,
        'unit_price_cents', 10000,
        'tax_rate_percent', 20,
        'position', 0
      )
    )
  );
  $$,
  'owner can create a bill draft with lines'
);

update _bills_fixture
set
  bill_id = bills.id,
  bill_version = bills.version
from public.bills
where bills.org_id = (select org_id from _bills_fixture)
  and bills.number = 'VENDOR-1001'
  and bills.deleted_at is null;

select is(
  (select subtotal_cents from public.bills where id = (select bill_id from _bills_fixture)),
  10000::bigint,
  'bill subtotal is server-calculated from lines'
);

select is(
  (select tax_cents from public.bills where id = (select bill_id from _bills_fixture)),
  2000::bigint,
  'bill tax is server-calculated from lines'
);

select is(
  (select total_cents from public.bills where id = (select bill_id from _bills_fixture)),
  11900::bigint,
  'bill total applies discount then tax'
);

select is(
  (select balance_due_cents from public.bills where id = (select bill_id from _bills_fixture)),
  11900::bigint,
  'bill balance due matches total for unpaid draft'
);

select ok(
  (select party_snapshot ? 'vendor' from public.bills where id = (select bill_id from _bills_fixture)),
  'create draft snapshots vendor party'
);

select throws_ok(
  $$
  select pg_temp.as_user(billing_id) from _bills_fixture;
  select public.create_bill_draft(
    (select org_id from _bills_fixture),
    jsonb_build_object(
      'vendor_id', (select vendor_id from _bills_fixture),
      'number', 'BILLING-DENIED',
      'currency', 'GBP',
      'due_on', current_date::text
    ),
    '[]'::jsonb
  );
  $$,
  '42501',
  'This action is not permitted',
  'billing role cannot create bill drafts'
);

select throws_ok(
  $$
  select pg_temp.as_user(outsider_id) from _bills_fixture;
  select public.create_bill_draft(
    (select org_id from _bills_fixture),
    jsonb_build_object(
      'vendor_id', (select vendor_id from _bills_fixture),
      'number', 'CROSS-ORG',
      'currency', 'GBP',
      'due_on', current_date::text
    ),
    '[]'::jsonb
  );
  $$,
  '42501',
  'This action is not permitted',
  'cross-org create is denied'
);

select throws_ok(
  $$
  select pg_temp.as_user(owner_id) from _bills_fixture;
  select public.save_bill_draft(
    (select bill_id from _bills_fixture),
    (select org_id from _bills_fixture),
    (select bill_version from _bills_fixture) + 1,
    jsonb_build_object('notes', 'stale'),
    null
  );
  $$,
  'P0001',
  'Bill version conflict',
  'stale version save is rejected'
);

select lives_ok(
  $$
  select pg_temp.as_user(owner_id) from _bills_fixture;
  select public.save_bill_draft(
    (select bill_id from _bills_fixture),
    (select org_id from _bills_fixture),
    (select bill_version from _bills_fixture),
    jsonb_build_object('notes', 'Updated draft note'),
    null
  );
  $$,
  'owner can save bill draft with matching version'
);

update _bills_fixture
set bill_version = bills.version
from public.bills
where bills.id = (select bill_id from _bills_fixture);

select lives_ok(
  $$
  select pg_temp.as_user(owner_id) from _bills_fixture;
  select public.receive_bill(
    (select bill_id from _bills_fixture),
    (select org_id from _bills_fixture),
    (select bill_version from _bills_fixture)
  );
  $$,
  'owner can receive a draft bill'
);

select is(
  (select status from public.bills where id = (select bill_id from _bills_fixture)),
  'received',
  'receive transitions status to received'
);

select ok(
  (select received_on is not null from public.bills where id = (select bill_id from _bills_fixture)),
  'receive sets received_on'
);

update _bills_fixture
set bill_version = bills.version
from public.bills
where bills.id = (select bill_id from _bills_fixture);

select throws_ok(
  $$
  select pg_temp.as_user(owner_id) from _bills_fixture;
  select public.save_bill_draft(
    (select bill_id from _bills_fixture),
    (select org_id from _bills_fixture),
    (select bill_version from _bills_fixture),
    jsonb_build_object('notes', 'locked'),
    null
  );
  $$,
  '22023',
  'Only draft bills can be edited in this release',
  'received bills cannot be edited'
);

select throws_ok(
  $$
  select pg_temp.as_user(owner_id) from _bills_fixture;
  select public.soft_delete_bill_draft(
    (select bill_id from _bills_fixture),
    (select org_id from _bills_fixture),
    (select bill_version from _bills_fixture)
  );
  $$,
  '22023',
  'Only draft bills can be deleted',
  'received bills cannot be soft-deleted'
);

select lives_ok(
  $$
  select pg_temp.as_user(owner_id) from _bills_fixture;
  select public.void_bill(
    (select bill_id from _bills_fixture),
    (select org_id from _bills_fixture),
    (select bill_version from _bills_fixture),
    'Duplicate vendor invoice'
  );
  $$,
  'owner can void a received bill'
);

select is(
  (select status from public.bills where id = (select bill_id from _bills_fixture)),
  'void',
  'void transitions status to void'
);

select is(
  (select balance_due_cents from public.bills where id = (select bill_id from _bills_fixture)),
  0::bigint,
  'void zeroes balance due'
);

-- Fresh draft for soft-delete + unique number collision probes
select lives_ok(
  $$
  select pg_temp.as_user(owner_id) from _bills_fixture;
  select public.create_bill_draft(
    (select org_id from _bills_fixture),
    jsonb_build_object(
      'vendor_id', (select vendor_id from _bills_fixture),
      'number', 'VENDOR-SOFTDEL',
      'currency', 'GBP',
      'due_on', (current_date + 14)::text
    ),
    jsonb_build_array(
      jsonb_build_object(
        'description', 'Disposable',
        'quantity', 1,
        'unit_price_cents', 500,
        'position', 0
      )
    )
  );
  $$,
  'owner can create a disposable draft for soft-delete'
);

select lives_ok(
  $$
  select pg_temp.as_user(owner_id) from _bills_fixture;
  select public.soft_delete_bill_draft(
    b.id,
    b.org_id,
    b.version
  )
  from public.bills b
  where b.org_id = (select org_id from _bills_fixture)
    and b.number = 'VENDOR-SOFTDEL'
    and b.deleted_at is null;
  $$,
  'owner can soft-delete a draft bill'
);

select is(
  (
    select count(*)::integer
    from public.bills
    where org_id = (select org_id from _bills_fixture)
      and number = 'VENDOR-SOFTDEL'
      and deleted_at is null
  ),
  0,
  'soft-deleted draft is hidden from active rows'
);

-- Same vendor number collision across active rows
select lives_ok(
  $$
  select pg_temp.as_user(owner_id) from _bills_fixture;
  select public.create_bill_draft(
    (select org_id from _bills_fixture),
    jsonb_build_object(
      'vendor_id', (select vendor_id from _bills_fixture),
      'number', 'VENDOR-DUP',
      'currency', 'GBP',
      'due_on', current_date::text
    ),
    jsonb_build_array(
      jsonb_build_object(
        'description', 'First',
        'quantity', 1,
        'unit_price_cents', 100,
        'position', 0
      )
    )
  );
  $$,
  'first active bill with vendor number succeeds'
);

select throws_ok(
  $$
  select pg_temp.as_user(owner_id) from _bills_fixture;
  select public.create_bill_draft(
    (select org_id from _bills_fixture),
    jsonb_build_object(
      'vendor_id', (select vendor_id from _bills_fixture),
      'number', 'VENDOR-DUP',
      'currency', 'GBP',
      'due_on', current_date::text
    ),
    jsonb_build_array(
      jsonb_build_object(
        'description', 'Second',
        'quantity', 1,
        'unit_price_cents', 100,
        'position', 0
      )
    )
  );
  $$,
  '23505',
  NULL,
  'duplicate active vendor bill number is rejected'
);

select throws_ok(
  $$
  select pg_temp.as_user(owner_id) from _bills_fixture;
  select public.create_bill_draft(
    (select org_id from _bills_fixture),
    jsonb_build_object(
      'vendor_id', (select other_vendor_id from _bills_fixture),
      'number', 'CROSS-VENDOR-ORG',
      'currency', 'GBP',
      'due_on', current_date::text
    ),
    '[]'::jsonb
  );
  $$,
  '22023',
  'Bill vendor must be an active vendor in the same organisation',
  'cross-org vendor reference is rejected'
);

select is(
  (
    select count(*)::integer
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'vendors'
      and column_name = 'bank_details_encrypted'
      and grantee = 'authenticated'
      and privilege_type = 'SELECT'
  ),
  0,
  'authenticated cannot select bank_details_encrypted'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.soft_delete_vendor(uuid, uuid, integer)',
    'execute'
  ),
  'authenticated users can execute soft_delete_vendor'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.get_bill_document(uuid, uuid)',
    'execute'
  ),
  'authenticated users can execute get_bill_document'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.save_bill_draft(uuid, uuid, integer, jsonb, jsonb)',
    'execute'
  ),
  'authenticated users can execute save_bill_draft'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.soft_delete_bill_draft(uuid, uuid, integer)',
    'execute'
  ),
  'authenticated users can execute soft_delete_bill_draft'
);

select finish();
rollback;

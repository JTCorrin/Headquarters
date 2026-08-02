begin;

select plan(58);

select has_table('public', 'invoices', 'invoices table exists');
select has_table('public', 'invoice_lines', 'invoice_lines table exists');

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.invoices'::regclass
  ),
  'invoices have row level security enabled'
);

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.invoice_lines'::regclass
  ),
  'invoice_lines have row level security enabled'
);

select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'invoices'
      and policyname = 'invoices_select_member'
  ),
  'invoices select policy exists'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'invoices'
      and indexname = 'invoices_org_number_uidx'
  ),
  'invoice numbers are unique per organisation among active rows'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_invoice_draft(uuid, jsonb, jsonb)',
    'execute'
  ),
  'authenticated users can execute create_invoice_draft'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.save_invoice_draft(uuid, uuid, integer, jsonb, jsonb)',
    'execute'
  ),
  'authenticated users can execute save_invoice_draft'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.send_invoice(uuid, uuid, integer)',
    'execute'
  ),
  'authenticated users can execute send_invoice'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.void_invoice(uuid, uuid, integer, text)',
    'execute'
  ),
  'authenticated users can execute void_invoice'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.accept_quote(uuid, uuid, integer)',
    'execute'
  ),
  'authenticated users can execute accept_quote'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_invoice_from_quote(uuid, uuid)',
    'execute'
  ),
  'authenticated users can execute create_invoice_from_quote'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.create_invoice_draft(uuid, jsonb, jsonb)',
    'execute'
  ),
  'anonymous users cannot execute create_invoice_draft'
);

select ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'invoice_lines'
      and grantee = 'authenticated'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ),
  'authenticated users cannot mutate invoice lines directly'
);

create temporary table _invoices_fixture (
  owner_id uuid,
  billing_id uuid,
  readonly_id uuid,
  outsider_id uuid,
  org_id uuid,
  other_org_id uuid,
  owner_membership_id uuid,
  client_id uuid,
  contact_id uuid,
  product_id uuid,
  tax_rate_id uuid,
  quote_id uuid,
  quote_version integer,
  invoice_id uuid,
  invoice_version integer
) on commit drop;

grant all on table _invoices_fixture to authenticated;

create or replace function pg_temp.make_auth_user(p_email text, p_name text)
returns uuid
language plpgsql
as $$
declare
  created_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    created_id,
    'authenticated',
    'authenticated',
    p_email,
    extensions.crypt('invoices-test-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('display_name', p_name),
    now(),
    now(),
    '',
    '',
    '',
    ''
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

insert into _invoices_fixture (owner_id, billing_id, readonly_id, outsider_id)
values (
  pg_temp.make_auth_user('invoices-owner@example.test', 'Invoices Owner'),
  pg_temp.make_auth_user('invoices-billing@example.test', 'Invoices Billing'),
  pg_temp.make_auth_user('invoices-readonly@example.test', 'Invoices Readonly'),
  pg_temp.make_auth_user('invoices-outsider@example.test', 'Invoices Outsider')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Invoices Org',
    'invoices-org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
),
other_org as (
  insert into public.organisations (name, slug, country_code)
  values (
    'Other Invoices Org',
    'other-invoices-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB'
  )
  returning id
)
update _invoices_fixture
set
  org_id = created_org.id,
  other_org_id = other_org.id
from created_org, other_org;

insert into public.document_sequences (org_id, document_type, prefix, next_number, padding)
select org_id, 'quote', 'Q-', 1, 4 from _invoices_fixture
on conflict do nothing;

insert into public.document_sequences (org_id, document_type, prefix, next_number, padding)
select org_id, 'invoice', 'INV-', 1, 4 from _invoices_fixture
on conflict do nothing;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _invoices_fixture;

insert into public.memberships (org_id, user_id, role, status)
select org_id, billing_id, 'billing', 'active' from _invoices_fixture;

insert into public.memberships (org_id, user_id, role, status)
select org_id, readonly_id, 'readonly', 'active' from _invoices_fixture;

insert into public.memberships (org_id, user_id, role, status)
select other_org_id, outsider_id, 'owner', 'active' from _invoices_fixture;

update _invoices_fixture
set owner_membership_id = (
  select memberships.id
  from public.memberships
  join _invoices_fixture f
    on f.org_id = memberships.org_id
   and f.owner_id = memberships.user_id
);

with created_tax as (
  insert into public.tax_rates (org_id, name, rate_percent, is_default, active)
  select org_id, 'VAT 20%', 20, true, true from _invoices_fixture
  returning id
)
update _invoices_fixture set tax_rate_id = created_tax.id from created_tax;

with created_product as (
  insert into public.products (
    org_id, sku, name, product_type, unit_price_cents, currency,
    tax_rate_id, track_stock, status
  )
  select
    org_id, 'RET-M', 'Monthly retainer', 'service', 10000, 'GBP',
    tax_rate_id, false, 'active'
  from _invoices_fixture
  returning id
)
update _invoices_fixture set product_id = created_product.id from created_product;

with created_client as (
  insert into public.clients (org_id, name, status, primary_email)
  select org_id, 'Acme Client', 'active', 'ap@acme.test' from _invoices_fixture
  returning id
)
update _invoices_fixture set client_id = created_client.id from created_client;

with created_contact as (
  insert into public.contacts (org_id, display_name, primary_email)
  select org_id, 'Ada Lovelace', 'ada@acme.test' from _invoices_fixture
  returning id
)
update _invoices_fixture set contact_id = created_contact.id from created_contact;

select ok(
  exists (
    select 1 from public.document_sequences
    where org_id = (select org_id from _invoices_fixture)
      and document_type = 'invoice'
      and prefix = 'INV-'
  ),
  'fixture organisation has an invoice document sequence'
);

select pg_temp.as_user((select owner_id from _invoices_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.create_invoice_draft(
      (select org_id from _invoices_fixture),
      jsonb_build_object(
        'client_id', (select client_id from _invoices_fixture),
        'contact_id', (select contact_id from _invoices_fixture)
      ),
      jsonb_build_array(
        jsonb_build_object(
          'product_id', (select product_id from _invoices_fixture),
          'quantity', 2,
          'position', 0
        )
      )
    )
  $$,
  'owner can create an invoice draft with a product line'
);

update _invoices_fixture
set
  invoice_id = invoices.id,
  invoice_version = invoices.version
from public.invoices
where invoices.org_id = _invoices_fixture.org_id
  and invoices.deleted_at is null;

select is(
  (select number from public.invoices where id = (select invoice_id from _invoices_fixture)),
  'INV-0001',
  'first invoice allocates INV-0001'
);

select ok(
  (
    select subtotal_cents = 20000
      and tax_cents = 4000
      and total_cents = 24000
      and balance_due_cents = 24000
      and paid_cents = 0
      and status = 'draft'
      and source = 'manual'
      and due_on = issue_on + 30
    from public.invoices
    where id = (select invoice_id from _invoices_fixture)
  ),
  'create snapshots product tax, calculates totals, and defaults due_on to issue_on + 30 days'
);

select ok(
  (
    select sku_snapshot = 'RET-M'
      and tax_rate_percent = 20
      and unit_price_cents = 10000
      and quantity = 2
    from public.invoice_lines
    where invoice_id = (select invoice_id from _invoices_fixture)
  ),
  'product line inherits sku, unit price, and tax rate snapshots'
);

select throws_ok(
  $$
    select public.create_invoice_draft(
      (select org_id from _invoices_fixture),
      '{}'::jsonb,
      '[]'::jsonb
    )
  $$,
  '22023',
  null,
  'create rejects invoices without client_id'
);

select lives_ok(
  $$
    select public.save_invoice_draft(
      (select invoice_id from _invoices_fixture),
      (select org_id from _invoices_fixture),
      (select invoice_version from _invoices_fixture),
      jsonb_build_object('discount_cents', 1000, 'purchase_order_number', 'PO-42'),
      jsonb_build_array(
        jsonb_build_object(
          'description', 'Custom line',
          'quantity', 1,
          'unit_price_cents', 5000,
          'tax_rate_percent', 20,
          'position', 0
        )
      )
    )
  $$,
  'owner can atomically replace invoice lines'
);

update _invoices_fixture
set invoice_version = invoices.version
from public.invoices
where invoices.id = _invoices_fixture.invoice_id;

select ok(
  (
    select count(*) = 1
      and max(description) = 'Custom line'
    from public.invoice_lines
    where invoice_id = (select invoice_id from _invoices_fixture)
  ),
  'save replaces prior lines atomically'
);

select ok(
  (
    select subtotal_cents = 5000
      and discount_cents = 1000
      and tax_cents = 1000
      and total_cents = 5000
      and balance_due_cents = 5000
      and purchase_order_number = 'PO-42'
    from public.invoices
    where id = (select invoice_id from _invoices_fixture)
  ),
  'header discount reduces total and balance_due after line tax rollup'
);

select throws_ok(
  $$
    select public.save_invoice_draft(
      (select invoice_id from _invoices_fixture),
      (select org_id from _invoices_fixture),
      1,
      jsonb_build_object('purchase_order_number', 'stale'),
      null
    )
  $$,
  'P0001',
  null,
  'save rejects stale expected versions'
);

select throws_ok(
  $$
    insert into public.invoice_lines (
      org_id, invoice_id, description, quantity, unit_price_cents,
      tax_rate_percent, subtotal_cents, tax_cents, total_cents, position
    )
    select
      org_id, invoice_id, 'Direct', 1, 100, 0, 100, 0, 100, 9
    from _invoices_fixture
  $$,
  '42501',
  null,
  'authenticated role cannot insert invoice lines directly'
);

select throws_ok(
  $$
    update public.invoices
    set purchase_order_number = 'HACK'
    where id = (select invoice_id from _invoices_fixture)
  $$,
  '42501',
  null,
  'authenticated role cannot update invoices directly'
);

reset role;
select pg_temp.as_user((select billing_id from _invoices_fixture));
set local role authenticated;

select is(
  (
    select count(*)::integer
    from public.invoices
    where org_id = (select org_id from _invoices_fixture)
  ),
  1,
  'billing members can select invoices per the domain model'
);

select throws_ok(
  $$
    select public.create_invoice_draft(
      (select org_id from _invoices_fixture),
      jsonb_build_object('client_id', (select client_id from _invoices_fixture)),
      '[]'::jsonb
    )
  $$,
  '42501',
  null,
  'billing members cannot create invoices'
);

reset role;
select pg_temp.as_user((select readonly_id from _invoices_fixture));
set local role authenticated;

select ok(
  exists (
    select 1 from public.invoices
    where id = (select invoice_id from _invoices_fixture)
  ),
  'readonly members can read invoices'
);

select throws_ok(
  $$
    select public.save_invoice_draft(
      (select invoice_id from _invoices_fixture),
      (select org_id from _invoices_fixture),
      (select invoice_version from _invoices_fixture),
      jsonb_build_object('purchase_order_number', 'blocked'),
      null
    )
  $$,
  '42501',
  null,
  'readonly members cannot mutate invoices'
);

reset role;
select pg_temp.as_user((select outsider_id from _invoices_fixture));
set local role authenticated;

select is(
  (
    select count(*)::integer
    from public.invoices
    where id = (select invoice_id from _invoices_fixture)
  ),
  0,
  'outsiders cannot read another organisation invoice'
);

select throws_ok(
  $$
    select public.get_invoice_document(
      (select invoice_id from _invoices_fixture),
      (select other_org_id from _invoices_fixture)
    )
  $$,
  'P0002',
  null,
  'cross-org invoice lookup is denied'
);

reset role;
select pg_temp.as_user((select owner_id from _invoices_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.soft_delete_invoice_draft(
      (select invoice_id from _invoices_fixture),
      (select org_id from _invoices_fixture),
      (select invoice_version from _invoices_fixture)
    )
  $$,
  'owner can soft-delete a draft invoice'
);

select is(
  (
    select count(*)::integer
    from public.invoices
    where id = (select invoice_id from _invoices_fixture)
  ),
  0,
  'soft-deleted invoices are hidden by RLS'
);

-- Rebuild a live draft for lifecycle (send/void) probes.
select lives_ok(
  $$
    select public.create_invoice_draft(
      (select org_id from _invoices_fixture),
      jsonb_build_object(
        'client_id', (select client_id from _invoices_fixture),
        'contact_id', (select contact_id from _invoices_fixture)
      ),
      jsonb_build_array(
        jsonb_build_object(
          'description', 'Lifecycle line',
          'quantity', 1,
          'unit_price_cents', 100000,
          'tax_rate_percent', 20,
          'position', 0
        )
      )
    )
  $$,
  'owner can create a fresh draft for lifecycle probes'
);

update _invoices_fixture
set
  invoice_id = invoices.id,
  invoice_version = invoices.version
from public.invoices
where invoices.org_id = _invoices_fixture.org_id
  and invoices.deleted_at is null;

select ok(
  (
    select
      (public.get_invoice_document(invoice_id, org_id) -> 'invoice' ->> 'version')::integer
        = invoice_version
      and jsonb_array_length(public.get_invoice_document(invoice_id, org_id) -> 'lines') = 1
    from _invoices_fixture
  ),
  'get_invoice_document returns a consistent header version and line set'
);

select throws_ok(
  $$
    select public.void_invoice(
      (select invoice_id from _invoices_fixture),
      (select org_id from _invoices_fixture),
      (select invoice_version from _invoices_fixture),
      null
    )
  $$,
  '22023',
  null,
  'void_invoice requires a non-empty void_reason'
);

select lives_ok(
  $$
    select public.send_invoice(
      (select invoice_id from _invoices_fixture),
      (select org_id from _invoices_fixture),
      (select invoice_version from _invoices_fixture)
    )
  $$,
  'owner can send a draft invoice'
);

update _invoices_fixture
set invoice_version = invoices.version
from public.invoices
where invoices.id = _invoices_fixture.invoice_id;

select ok(
  (
    select status = 'sent'
      and sent_at is not null
      and balance_due_cents = total_cents
      and party_snapshot -> 'client' ->> 'name' = 'Acme Client'
      and party_snapshot -> 'contact' ->> 'display_name' = 'Ada Lovelace'
    from public.invoices
    where id = (select invoice_id from _invoices_fixture)
  ),
  'send builds an immutable party snapshot and locks the invoice as sent'
);

select throws_ok(
  $$
    select public.save_invoice_draft(
      (select invoice_id from _invoices_fixture),
      (select org_id from _invoices_fixture),
      (select invoice_version from _invoices_fixture),
      jsonb_build_object('purchase_order_number', 'post-send edit'),
      null
    )
  $$,
  '22023',
  null,
  'sending an invoice locks it against further draft edits'
);

select throws_ok(
  $$
    select public.send_invoice(
      (select invoice_id from _invoices_fixture),
      (select org_id from _invoices_fixture),
      (select invoice_version from _invoices_fixture)
    )
  $$,
  '22023',
  null,
  'an already-sent invoice cannot be sent again'
);

select lives_ok(
  $$
    select public.void_invoice(
      (select invoice_id from _invoices_fixture),
      (select org_id from _invoices_fixture),
      (select invoice_version from _invoices_fixture),
      'Issued in error'
    )
  $$,
  'owner can void a sent invoice with a reason'
);

update _invoices_fixture
set invoice_version = invoices.version
from public.invoices
where invoices.id = _invoices_fixture.invoice_id;

select ok(
  (
    select status = 'void'
      and voided_at is not null
      and void_reason = 'Issued in error'
    from public.invoices
    where id = (select invoice_id from _invoices_fixture)
  ),
  'void sets status, voided_at, and void_reason'
);

select throws_ok(
  $$
    select public.void_invoice(
      (select invoice_id from _invoices_fixture),
      (select org_id from _invoices_fixture),
      (select invoice_version from _invoices_fixture),
      'Again'
    )
  $$,
  '22023',
  null,
  'an already-void invoice cannot be voided again'
);

-- draft → void is also allowed directly (without passing through sent).
select lives_ok(
  $$
    select public.create_invoice_draft(
      (select org_id from _invoices_fixture),
      jsonb_build_object('client_id', (select client_id from _invoices_fixture)),
      '[]'::jsonb
    )
  $$,
  'owner can create another draft for the draft-void probe'
);

update _invoices_fixture
set
  invoice_id = invoices.id,
  invoice_version = invoices.version
from public.invoices
where invoices.org_id = _invoices_fixture.org_id
  and invoices.status = 'draft'
  and invoices.deleted_at is null;

select lives_ok(
  $$
    select public.void_invoice(
      (select invoice_id from _invoices_fixture),
      (select org_id from _invoices_fixture),
      (select invoice_version from _invoices_fixture),
      'Abandoned draft'
    )
  $$,
  'a draft invoice can be voided directly'
);

select ok(
  (
    select status = 'void'
    from public.invoices
    where id = (select invoice_id from _invoices_fixture)
  ),
  'draft-to-void transition succeeds without passing through sent'
);

-- ---------------------------------------------------------------------------
-- create_invoice_from_quote
-- ---------------------------------------------------------------------------

select lives_ok(
  $$
    select public.create_quote_draft(
      (select org_id from _invoices_fixture),
      jsonb_build_object(
        'title', 'Convertible quote',
        'client_id', (select client_id from _invoices_fixture),
        'contact_id', (select contact_id from _invoices_fixture)
      ),
      jsonb_build_array(
        jsonb_build_object(
          'product_id', (select product_id from _invoices_fixture),
          'quantity', 3,
          'position', 0
        )
      )
    )
  $$,
  'owner can create a quote to later convert into an invoice'
);

update _invoices_fixture
set
  quote_id = quotes.id,
  quote_version = quotes.version
from public.quotes
where quotes.org_id = _invoices_fixture.org_id
  and quotes.title = 'Convertible quote'
  and quotes.deleted_at is null;

select throws_ok(
  $$
    select public.create_invoice_from_quote(
      (select quote_id from _invoices_fixture),
      (select org_id from _invoices_fixture)
    )
  $$,
  '22023',
  null,
  'only accepted quotes can be converted to an invoice'
);

select lives_ok(
  $$
    select public.accept_quote(
      (select quote_id from _invoices_fixture),
      (select org_id from _invoices_fixture),
      (select quote_version from _invoices_fixture)
    )
  $$,
  'owner can accept a draft quote for invoicing'
);

update _invoices_fixture
set quote_version = quotes.version
from public.quotes
where quotes.id = _invoices_fixture.quote_id;

select ok(
  (
    select status = 'accepted'
      and accepted_at is not null
      and party_snapshot ? 'client'
    from public.quotes
    where id = (select quote_id from _invoices_fixture)
  ),
  'accept_quote freezes party snapshot and marks the quote accepted'
);

select lives_ok(
  $$
    select public.create_invoice_from_quote(
      (select quote_id from _invoices_fixture),
      (select org_id from _invoices_fixture)
    )
  $$,
  'owner can convert an accepted quote into an invoice'
);

select ok(
  (
    select
      invoices.source = 'quote'
      and invoices.quote_id = f.quote_id
      and invoices.status = 'draft'
      and invoices.subtotal_cents = quotes.subtotal_cents
      and invoices.total_cents = quotes.total_cents
      and invoices.balance_due_cents = quotes.total_cents
      and invoices.party_snapshot = quotes.party_snapshot
    from _invoices_fixture f
    join public.quotes on quotes.id = f.quote_id
    join public.invoices on invoices.id = quotes.converted_invoice_id
  ),
  'converted invoice copies quote totals and party snapshot without mutation'
);

select ok(
  (
    select count(*) = 1
    from public.invoice_lines
    join public.quotes on quotes.id = (select quote_id from _invoices_fixture)
    where invoice_lines.invoice_id = quotes.converted_invoice_id
  ),
  'converted invoice copies quote lines'
);

select ok(
  (
    select count(*) = 1 and max(quantity) = 3
    from public.quote_lines
    where quote_id = (select quote_id from _invoices_fixture)
  ),
  'converting to an invoice does not mutate the source quote lines'
);

select ok(
  (
    select converted_invoice_id is not null
    from public.quotes
    where id = (select quote_id from _invoices_fixture)
  ),
  'quotes.converted_invoice_id is set on conversion'
);

select ok(
  (
    with reconvert as (
      select public.create_invoice_from_quote(
        (select quote_id from _invoices_fixture),
        (select org_id from _invoices_fixture)
      ) as result
    )
    select
      (result ->> 'created')::boolean = false
      and (result -> 'invoice' ->> 'id')::uuid = quotes.converted_invoice_id
    from reconvert, public.quotes
    where quotes.id = (select quote_id from _invoices_fixture)
  ),
  'reconverting an already-converted quote is idempotent'
);

reset role;
select pg_temp.as_user((select outsider_id from _invoices_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.create_invoice_from_quote(
      (select quote_id from _invoices_fixture),
      (select other_org_id from _invoices_fixture)
    )
  $$,
  'P0002',
  null,
  'converting a quote from a different organisation is denied'
);

reset role;

select * from finish();
rollback;

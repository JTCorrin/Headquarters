begin;

select plan(55);

select has_table('public', 'quotes', 'quotes table exists');
select has_table('public', 'quote_lines', 'quote_lines table exists');
select has_table('public', 'document_sequences', 'document_sequences table exists');

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.quotes'::regclass
  ),
  'quotes have row level security enabled'
);

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.quote_lines'::regclass
  ),
  'quote_lines have row level security enabled'
);

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.document_sequences'::regclass
  ),
  'document_sequences have row level security enabled'
);

select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'quotes'
      and policyname = 'quotes_select_member'
  ),
  'quotes select policy exists'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'quotes'
      and indexname = 'quotes_org_number_uidx'
  ),
  'quote numbers are unique per organisation among active rows'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_quote_draft(uuid, jsonb, jsonb, uuid)',
    'execute'
  ),
  'authenticated users can execute create_quote_draft'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.save_quote_draft(uuid, uuid, integer, jsonb, jsonb, uuid)',
    'execute'
  ),
  'authenticated users can execute save_quote_draft'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.create_quote_draft(uuid, jsonb, jsonb, uuid)',
    'execute'
  ),
  'anonymous users cannot execute create_quote_draft'
);

select ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'document_sequences'
      and grantee = 'authenticated'
  ),
  'authenticated role has no document_sequences grants'
);

select ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'quote_lines'
      and grantee = 'authenticated'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ),
  'authenticated users cannot mutate quote lines directly'
);

create temporary table _quotes_fixture (
  owner_id uuid,
  billing_id uuid,
  readonly_id uuid,
  outsider_id uuid,
  org_id uuid,
  other_org_id uuid,
  owner_membership_id uuid,
  client_id uuid,
  lead_id uuid,
  product_id uuid,
  tax_rate_id uuid,
  quote_id uuid,
  quote_version integer
) on commit drop;

grant all on table _quotes_fixture to authenticated;

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
    extensions.crypt('quotes-test-password', extensions.gen_salt('bf')),
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

insert into _quotes_fixture (owner_id, billing_id, readonly_id, outsider_id)
values (
  pg_temp.make_auth_user('quotes-owner@example.test', 'Quotes Owner'),
  pg_temp.make_auth_user('quotes-billing@example.test', 'Quotes Billing'),
  pg_temp.make_auth_user('quotes-readonly@example.test', 'Quotes Readonly'),
  pg_temp.make_auth_user('quotes-outsider@example.test', 'Quotes Outsider')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Quotes Org',
    'quotes-org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
),
other_org as (
  insert into public.organisations (name, slug, country_code)
  values (
    'Other Quotes Org',
    'other-quotes-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB'
  )
  returning id
)
update _quotes_fixture
set
  org_id = created_org.id,
  other_org_id = other_org.id
from created_org, other_org;

insert into public.document_sequences (org_id, document_type, prefix, next_number, padding)
select org_id, 'quote', 'Q-', 1, 4 from _quotes_fixture
on conflict do nothing;

insert into public.document_sequences (org_id, document_type, prefix, next_number, padding)
select other_org_id, 'quote', 'Q-', 1, 4 from _quotes_fixture
on conflict do nothing;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _quotes_fixture;

insert into public.memberships (org_id, user_id, role, status)
select org_id, billing_id, 'billing', 'active' from _quotes_fixture;

insert into public.memberships (org_id, user_id, role, status)
select org_id, readonly_id, 'readonly', 'active' from _quotes_fixture;

insert into public.memberships (org_id, user_id, role, status)
select other_org_id, outsider_id, 'owner', 'active' from _quotes_fixture;

update _quotes_fixture
set owner_membership_id = (
  select memberships.id
  from public.memberships
  join _quotes_fixture f
    on f.org_id = memberships.org_id
   and f.owner_id = memberships.user_id
);

with created_tax as (
  insert into public.tax_rates (org_id, name, rate_percent, is_default, active)
  select org_id, 'VAT 20%', 20, true, true from _quotes_fixture
  returning id
)
update _quotes_fixture set tax_rate_id = created_tax.id from created_tax;

with created_product as (
  insert into public.products (
    org_id, sku, name, product_type, unit_price_cents, currency,
    tax_rate_id, track_stock, status
  )
  select
    org_id, 'RET-M', 'Monthly retainer', 'service', 10000, 'GBP',
    tax_rate_id, false, 'active'
  from _quotes_fixture
  returning id
)
update _quotes_fixture set product_id = created_product.id from created_product;

with created_client as (
  insert into public.clients (org_id, name, status)
  select org_id, 'Acme Client', 'active' from _quotes_fixture
  returning id
)
update _quotes_fixture set client_id = created_client.id from created_client;

with created_lead as (
  insert into public.leads (org_id, name, stage, currency)
  select org_id, 'Pipeline Lead', 'qualified', 'GBP' from _quotes_fixture
  returning id
)
update _quotes_fixture set lead_id = created_lead.id from created_lead;

select ok(
  exists (
    select 1 from public.document_sequences
    where org_id = (select org_id from _quotes_fixture)
      and document_type = 'quote'
      and prefix = 'Q-'
  ),
  'fixture organisation has a quote document sequence'
);

select pg_temp.as_user((select owner_id from _quotes_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.create_quote_draft(
      (select org_id from _quotes_fixture),
      jsonb_build_object(
        'title', 'Q2 retainer',
        'client_id', (select client_id from _quotes_fixture),
        'discount_cents', 0
      ),
      jsonb_build_array(
        jsonb_build_object(
          'product_id', (select product_id from _quotes_fixture),
          'quantity', 2,
          'position', 0
        )
      )
    )
  $$,
  'owner can create a quote draft with a product line'
);

update _quotes_fixture
set
  quote_id = quotes.id,
  quote_version = quotes.version
from public.quotes
where quotes.org_id = _quotes_fixture.org_id
  and quotes.title = 'Q2 retainer'
  and quotes.deleted_at is null;

select is(
  (select number from public.quotes where id = (select quote_id from _quotes_fixture)),
  'Q-0001',
  'first quote allocates Q-0001'
);

select ok(
  (
    select subtotal_cents = 20000
      and tax_cents = 4000
      and total_cents = 24000
      and status = 'draft'
    from public.quotes
    where id = (select quote_id from _quotes_fixture)
  ),
  'create snapshots product tax and calculates exclusive totals'
);

select ok(
  (
    select sku_snapshot = 'RET-M'
      and tax_rate_percent = 20
      and unit_price_cents = 10000
      and quantity = 2
    from public.quote_lines
    where quote_id = (select quote_id from _quotes_fixture)
  ),
  'product line inherits sku, unit price, and tax rate snapshots'
);

select lives_ok(
  $$
    select public.create_quote_draft(
      (select org_id from _quotes_fixture),
      jsonb_build_object(
        'title', 'Lead-only quote',
        'lead_id', (select lead_id from _quotes_fixture)
      ),
      '[]'::jsonb
    )
  $$,
  'quote can be created against a lead without a client'
);

select is(
  (
    select number
    from public.quotes
    where org_id = (select org_id from _quotes_fixture)
      and title = 'Lead-only quote'
  ),
  'Q-0002',
  'second quote allocates the next document number'
);

select throws_ok(
  $$
    select public.create_quote_draft(
      (select org_id from _quotes_fixture),
      jsonb_build_object('title', 'No party'),
      '[]'::jsonb
    )
  $$,
  '22023',
  null,
  'create rejects quotes without client_id or lead_id'
);

select lives_ok(
  $$
    select public.save_quote_draft(
      (select quote_id from _quotes_fixture),
      (select org_id from _quotes_fixture),
      (select quote_version from _quotes_fixture),
      jsonb_build_object('title', 'Q2 retainer revised', 'discount_cents', 1000),
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
  'owner can atomically replace quote lines'
);

update _quotes_fixture
set quote_version = quotes.version
from public.quotes
where quotes.id = _quotes_fixture.quote_id;

select ok(
  (
    select count(*) = 1
      and max(description) = 'Custom line'
    from public.quote_lines
    where quote_id = (select quote_id from _quotes_fixture)
  ),
  'save replaces prior lines atomically'
);

select ok(
  (
    select subtotal_cents = 5000
      and discount_cents = 1000
      and tax_cents = 1000
      and total_cents = 5000
    from public.quotes
    where id = (select quote_id from _quotes_fixture)
  ),
  'header discount reduces total after line tax rollup'
);

select throws_ok(
  $$
    select public.save_quote_draft(
      (select quote_id from _quotes_fixture),
      (select org_id from _quotes_fixture),
      1,
      jsonb_build_object('title', 'stale'),
      null
    )
  $$,
  'P0001',
  null,
  'save rejects stale expected versions'
);

select throws_ok(
  $$
    insert into public.quote_lines (
      org_id, quote_id, description, quantity, unit_price_cents,
      tax_rate_percent, subtotal_cents, tax_cents, total_cents, position
    )
    select
      org_id, quote_id, 'Direct', 1, 100, 0, 100, 0, 100, 9
    from _quotes_fixture
  $$,
  '42501',
  null,
  'authenticated role cannot insert quote lines directly'
);

select throws_ok(
  $$
    update public.quotes
    set number = 'HACK-1'
    where id = (select quote_id from _quotes_fixture)
  $$,
  '42501',
  null,
  'authenticated role cannot update quotes directly'
);

reset role;
select pg_temp.as_user((select billing_id from _quotes_fixture));
set local role authenticated;

select is(
  (
    select count(*)::integer
    from public.quotes
    where org_id = (select org_id from _quotes_fixture)
  ),
  0,
  'billing members cannot select quotes'
);

select throws_ok(
  $$
    select public.create_quote_draft(
      (select org_id from _quotes_fixture),
      jsonb_build_object(
        'title', 'Billing blocked',
        'client_id', (select client_id from _quotes_fixture)
      ),
      '[]'::jsonb
    )
  $$,
  '42501',
  null,
  'billing members cannot create quotes'
);

reset role;
select pg_temp.as_user((select readonly_id from _quotes_fixture));
set local role authenticated;

select ok(
  exists (
    select 1 from public.quotes
    where id = (select quote_id from _quotes_fixture)
  ),
  'readonly members can read quotes'
);

select throws_ok(
  $$
    select public.save_quote_draft(
      (select quote_id from _quotes_fixture),
      (select org_id from _quotes_fixture),
      (select quote_version from _quotes_fixture),
      jsonb_build_object('title', 'Readonly blocked'),
      null
    )
  $$,
  '42501',
  null,
  'readonly members cannot mutate quotes'
);

reset role;
select pg_temp.as_user((select outsider_id from _quotes_fixture));
set local role authenticated;

select is(
  (
    select count(*)::integer
    from public.quotes
    where id = (select quote_id from _quotes_fixture)
  ),
  0,
  'outsiders cannot read another organisation quote'
);

reset role;
select pg_temp.as_user((select owner_id from _quotes_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.soft_delete_quote_draft(
      (select quote_id from _quotes_fixture),
      (select org_id from _quotes_fixture),
      (select quote_version from _quotes_fixture)
    )
  $$,
  'owner can soft-delete a draft quote'
);

select is(
  (
    select count(*)::integer
    from public.quotes
    where id = (select quote_id from _quotes_fixture)
  ),
  0,
  'soft-deleted quotes are hidden by RLS'
);

select throws_ok(
  $$
    select public.save_quote_draft(
      (select quote_id from _quotes_fixture),
      (select org_id from _quotes_fixture),
      (select quote_version from _quotes_fixture) + 1,
      jsonb_build_object('title', 'gone'),
      null
    )
  $$,
  'P0002',
  null,
  'soft-deleted quotes cannot be saved'
);

reset role;

select ok(
  (
    select next_number = 3
    from public.document_sequences
    where org_id = (select org_id from _quotes_fixture)
      and document_type = 'quote'
  ),
  'document sequence advances for each allocated quote number'
);

select pg_temp.as_user((select owner_id from _quotes_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.create_organisation(
      'Quotes Seed Org',
      'quotes-seed-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
      'GB'
    )
  $$,
  'create_organisation still works after quote sequence seeding'
);

reset role;

select ok(
  exists (
    select 1
    from public.document_sequences
    join public.organisations on organisations.id = document_sequences.org_id
    where organisations.name = 'Quotes Seed Org'
      and document_sequences.document_type = 'quote'
      and document_sequences.prefix = 'Q-'
  ),
  'create_organisation seeds a quote document sequence'
);

-- Rebuild a live draft for remaining lifecycle probes.
select pg_temp.as_user((select owner_id from _quotes_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.create_quote_draft(
      (select org_id from _quotes_fixture),
      jsonb_build_object(
        'title', 'Lifecycle quote',
        'client_id', (select client_id from _quotes_fixture),
        'currency', 'GBP'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'product_id', (select product_id from _quotes_fixture),
          'quantity', 1,
          'sku_snapshot', 'CLIENT-HACK',
          'position', 0
        )
      )
    )
  $$,
  'owner can recreate a draft for lifecycle probes'
);

update _quotes_fixture
set
  quote_id = quotes.id,
  quote_version = quotes.version
from public.quotes
where quotes.org_id = _quotes_fixture.org_id
  and quotes.title = 'Lifecycle quote'
  and quotes.deleted_at is null;

select is(
  (
    select sku_snapshot
    from public.quote_lines
    where quote_id = (select quote_id from _quotes_fixture)
  ),
  'RET-M',
  'product lines ignore client-supplied sku_snapshot and use the product SKU'
);

select ok(
  (
    select
      (public.get_quote_document(quote_id, org_id) -> 'quote' ->> 'version')::integer
        = quote_version
      and jsonb_array_length(public.get_quote_document(quote_id, org_id) -> 'lines') = 1
    from _quotes_fixture
  ),
  'get_quote_document returns a consistent header version and line set'
);

select throws_ok(
  $$
    select public.create_quote_draft(
      (select org_id from _quotes_fixture),
      jsonb_build_object(
        'title', 'Currency mismatch',
        'client_id', (select client_id from _quotes_fixture),
        'currency', 'USD'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'product_id', (select product_id from _quotes_fixture),
          'quantity', 1,
          'position', 0
        )
      )
    )
  $$,
  '22023',
  null,
  'create rejects product lines whose currency differs from the quote'
);

select throws_ok(
  $$
    select public.save_quote_draft(
      (select quote_id from _quotes_fixture),
      (select org_id from _quotes_fixture),
      (select quote_version from _quotes_fixture),
      jsonb_build_object('currency', 'USD'),
      null
    )
  $$,
  '22023',
  null,
  'save rejects currency-only changes without replacing lines'
);

select lives_ok(
  $$
    select public.save_quote_draft(
      (select quote_id from _quotes_fixture),
      (select org_id from _quotes_fixture),
      (select quote_version from _quotes_fixture),
      jsonb_build_object('currency', 'USD'),
      jsonb_build_array(
        jsonb_build_object(
          'description', 'USD free-text',
          'quantity', 1,
          'unit_price_cents', 100,
          'tax_rate_percent', 0,
          'position', 0
        )
      )
    )
  $$,
  'save allows currency change when lines are replaced atomically'
);

update _quotes_fixture
set quote_version = quotes.version
from public.quotes
where quotes.id = _quotes_fixture.quote_id;

select throws_ok(
  $$
    select public.create_quote_draft(
      (select org_id from _quotes_fixture),
      jsonb_build_object(
        'title', 'Unsafe money',
        'client_id', (select client_id from _quotes_fixture),
        'currency', 'GBP'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'description', 'Too big',
          'quantity', 2,
          'unit_price_cents', 9007199254740991,
          'tax_rate_percent', 0,
          'position', 0
        )
      )
    )
  $$,
  '22023',
  null,
  'create rejects line totals outside the JSON-safe integer range'
);

-- Individually safe lines/subtotal/tax can still produce an unsafe header total.
select throws_ok(
  $$
    select public.create_quote_draft(
      (select org_id from _quotes_fixture),
      jsonb_build_object(
        'title', 'Unsafe header total',
        'client_id', (select client_id from _quotes_fixture),
        'currency', 'GBP'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'description', 'A',
          'quantity', 1,
          'unit_price_cents', 4503599627370495,
          'tax_rate_percent', 100,
          'position', 0
        ),
        jsonb_build_object(
          'description', 'B',
          'quantity', 1,
          'unit_price_cents', 4503599627370495,
          'tax_rate_percent', 100,
          'position', 1
        )
      )
    )
  $$,
  '22023',
  null,
  'create rejects header total_cents outside the JSON-safe integer range'
);

select throws_ok(
  $$
    select public.save_quote_draft(
      (select quote_id from _quotes_fixture),
      (select org_id from _quotes_fixture),
      (select quote_version from _quotes_fixture),
      '{}'::jsonb,
      jsonb_build_array(
        jsonb_build_object(
          'description', 'A',
          'quantity', 1,
          'unit_price_cents', 4503599627370495,
          'tax_rate_percent', 100,
          'position', 0
        ),
        jsonb_build_object(
          'description', 'B',
          'quantity', 1,
          'unit_price_cents', 4503599627370495,
          'tax_rate_percent', 100,
          'position', 1
        )
      )
    )
  $$,
  '22023',
  null,
  'save rejects header total_cents outside the JSON-safe integer range'
);

-- Discount-only saves recompute header total without replace_quote_lines.
reset role;
do $$ begin perform set_config('app.allow_quote_totals', 'on', true); end $$;

delete from public.quote_lines
where quote_id = (select quote_id from _quotes_fixture);

insert into public.quote_lines (
  org_id,
  quote_id,
  description,
  quantity,
  unit_price_cents,
  discount_percent,
  tax_rate_percent,
  subtotal_cents,
  tax_cents,
  total_cents,
  position,
  created_by,
  updated_by
)
select
  f.org_id,
  f.quote_id,
  line.description,
  1,
  4503599627370495,
  0,
  100,
  4503599627370495,
  4503599627370495,
  9007199254740990,
  line.position,
  f.owner_id,
  f.owner_id
from _quotes_fixture f
cross join (
  values
    ('Planted A', 0),
    ('Planted B', 1)
) as line(description, position);

update public.quotes
set
  subtotal_cents = 9007199254740990,
  tax_cents = 9007199254740990,
  discount_cents = 0,
  -- Temporarily store a JSON-safe placeholder; save must recompute and reject.
  total_cents = 9007199254740991,
  updated_by = (select owner_id from _quotes_fixture)
where id = (select quote_id from _quotes_fixture);

-- stamp_business_row bumps version on the planted header write.
update _quotes_fixture
set quote_version = quotes.version
from public.quotes
where quotes.id = _quotes_fixture.quote_id;

do $$ begin perform set_config('app.allow_quote_totals', 'off', true); end $$;

select pg_temp.as_user((select owner_id from _quotes_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.save_quote_draft(
      (select quote_id from _quotes_fixture),
      (select org_id from _quotes_fixture),
      (select quote_version from _quotes_fixture),
      jsonb_build_object('discount_cents', 0),
      null
    )
  $$,
  '22023',
  null,
  'discount-only save rejects header total_cents outside the JSON-safe integer range'
);

-- Restore a JSON-safe line set so soft-delete lifecycle can continue.
reset role;
do $$ begin perform set_config('app.allow_quote_totals', 'on', true); end $$;

delete from public.quote_lines
where quote_id = (select quote_id from _quotes_fixture);

insert into public.quote_lines (
  org_id,
  quote_id,
  description,
  quantity,
  unit_price_cents,
  discount_percent,
  tax_rate_percent,
  subtotal_cents,
  tax_cents,
  total_cents,
  position,
  created_by,
  updated_by
)
select
  org_id,
  quote_id,
  'Restored free-text',
  1,
  100,
  0,
  0,
  100,
  0,
  100,
  0,
  owner_id,
  owner_id
from _quotes_fixture;

update public.quotes
set
  subtotal_cents = 100,
  tax_cents = 0,
  discount_cents = 0,
  total_cents = 100,
  updated_by = (select owner_id from _quotes_fixture)
where id = (select quote_id from _quotes_fixture);

update _quotes_fixture
set quote_version = quotes.version
from public.quotes
where quotes.id = _quotes_fixture.quote_id;

do $$ begin perform set_config('app.allow_quote_totals', 'off', true); end $$;

select pg_temp.as_user((select owner_id from _quotes_fixture));
set local role authenticated;

-- Omitted tax_rate_percent inherits the org default (same as CRM UI blank lines).
select lives_ok(
  $$
    select public.save_quote_draft(
      (select quote_id from _quotes_fixture),
      (select org_id from _quotes_fixture),
      (select quote_version from _quotes_fixture),
      jsonb_build_object('discount_cents', 0),
      jsonb_build_array(
        jsonb_build_object(
          'description', 'Omit tax free-text',
          'quantity', 1,
          'unit_price_cents', 10000,
          'position', 0
        )
      )
    )
  $$,
  'save accepts free-text lines that omit tax_rate_percent'
);

update _quotes_fixture
set quote_version = quotes.version
from public.quotes
where quotes.id = _quotes_fixture.quote_id;

select ok(
  (
    select tax_rate_percent = 20
      and tax_cents = 2000
      and total_cents = 12000
    from public.quote_lines
    where quote_id = (select quote_id from _quotes_fixture)
  ),
  'omitted free-text tax inherits org default rate'
);

select lives_ok(
  $$
    select public.save_quote_draft(
      (select quote_id from _quotes_fixture),
      (select org_id from _quotes_fixture),
      (select quote_version from _quotes_fixture),
      jsonb_build_object('discount_cents', 0),
      jsonb_build_array(
        jsonb_build_object(
          'description', 'Explicit zero tax',
          'quantity', 1,
          'unit_price_cents', 10000,
          'tax_rate_percent', 0,
          'position', 0
        )
      )
    )
  $$,
  'save accepts free-text lines with explicit zero tax'
);

update _quotes_fixture
set quote_version = quotes.version
from public.quotes
where quotes.id = _quotes_fixture.quote_id;

select ok(
  (
    select tax_rate_percent = 0
      and tax_cents = 0
      and total_cents = 10000
    from public.quote_lines
    where quote_id = (select quote_id from _quotes_fixture)
  ),
  'explicit tax_rate_percent 0 stays zero-rated (not org default)'
);

reset role;

-- Lifecycle probes earlier switched this quote to USD; keep the untaxed product
-- in the same currency so the org-default tax assertion is not masked by a
-- currency mismatch.
with created_untaxed as (
  insert into public.products (
    org_id, sku, name, product_type, unit_price_cents, currency,
    tax_rate_id, track_stock, status
  )
  select
    org_id, 'NO-TAX', 'Untaxed service', 'service', 10000, 'USD',
    null, false, 'active'
  from _quotes_fixture
  returning id
)
update _quotes_fixture set product_id = created_untaxed.id from created_untaxed;

select pg_temp.as_user((select owner_id from _quotes_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.save_quote_draft(
      (select quote_id from _quotes_fixture),
      (select org_id from _quotes_fixture),
      (select quote_version from _quotes_fixture),
      jsonb_build_object('discount_cents', 0),
      jsonb_build_array(
        jsonb_build_object(
          'product_id', (select product_id from _quotes_fixture),
          'quantity', 1,
          'position', 0
        )
      )
    )
  $$,
  'save accepts product lines without a catalog tax rate'
);

update _quotes_fixture
set quote_version = quotes.version
from public.quotes
where quotes.id = _quotes_fixture.quote_id;

select ok(
  (
    select tax_rate_percent = 20
      and tax_cents = 2000
      and total_cents = 12000
    from public.quote_lines
    where quote_id = (select quote_id from _quotes_fixture)
  ),
  'product without tax_rate_id inherits org default when tax omitted'
);

-- Soft-delete must still work after the linked client is removed.
reset role;
update public.clients
set deleted_at = now()
where id = (select client_id from _quotes_fixture);

select pg_temp.as_user((select owner_id from _quotes_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.soft_delete_quote_draft(
      (select quote_id from _quotes_fixture),
      (select org_id from _quotes_fixture),
      (select quote_version from _quotes_fixture)
    )
  $$,
  'soft-delete succeeds even when the linked client was later deleted'
);

select * from finish();
rollback;

begin;

select plan(44);

select has_table('public', 'product_categories', 'product_categories table exists');
select has_table('public', 'products', 'products table exists');
select has_table('public', 'inventory_movements', 'inventory_movements table exists');

select ok(
  (
    select relrowsecurity from pg_class where oid = 'public.products'::regclass
  ),
  'products have row level security enabled'
);

select ok(
  exists (
    select 1 from pg_proc
    join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'public' and pg_proc.proname = 'adjust_product_stock'
  ),
  'adjust_product_stock RPC exists'
);

select ok(
  not exists (
    select 1 from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'products'
      and column_name = 'stock_qty'
      and grantee = 'authenticated'
      and privilege_type in ('INSERT', 'UPDATE')
  ),
  'authenticated users cannot write products.stock_qty directly'
);

select ok(
  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'inventory_movements'
      and grantee = 'authenticated'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ),
  'authenticated users cannot mutate inventory_movements directly'
);

create temporary table _catalog_fixture (
  owner_id uuid,
  billing_id uuid,
  readonly_id uuid,
  outsider_id uuid,
  org_id uuid,
  other_org_id uuid,
  category_id uuid,
  product_id uuid,
  other_product_id uuid
) on commit drop;

grant all on table _catalog_fixture to authenticated;

create or replace function pg_temp.make_auth_user(p_email text, p_name text)
returns uuid language plpgsql as $$
declare created_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', created_id, 'authenticated', 'authenticated',
    p_email, extensions.crypt('catalog-test', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('display_name', p_name), now(), now(), '', '', '', ''
  );
  return created_id;
end;
$$;

insert into _catalog_fixture (owner_id, billing_id, readonly_id, outsider_id)
values (
  pg_temp.make_auth_user('catalog-owner@example.test', 'Catalog Owner'),
  pg_temp.make_auth_user('catalog-billing@example.test', 'Catalog Billing'),
  pg_temp.make_auth_user('catalog-readonly@example.test', 'Catalog Readonly'),
  pg_temp.make_auth_user('catalog-outsider@example.test', 'Catalog Outsider')
);

with created_org as (
  insert into public.organisations (name, slug, country_code)
  values ('Catalog Org', 'catalog-org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8), 'GB')
  returning id
),
other_org as (
  insert into public.organisations (name, slug, country_code)
  values ('Other Catalog Org', 'other-cat-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8), 'GB')
  returning id
)
update _catalog_fixture
set org_id = created_org.id, other_org_id = other_org.id
from created_org, other_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _catalog_fixture;
insert into public.memberships (org_id, user_id, role, status)
select org_id, billing_id, 'billing', 'active' from _catalog_fixture;
insert into public.memberships (org_id, user_id, role, status)
select org_id, readonly_id, 'readonly', 'active' from _catalog_fixture;
insert into public.memberships (org_id, user_id, role, status)
select other_org_id, outsider_id, 'owner', 'active' from _catalog_fixture;

-- Seed cross-tenant product as privileged role (before switching to authenticated).
with outsider_product as (
  insert into public.products (
    org_id, sku, name, product_type, unit_price_cents, currency,
    created_by, updated_by
  )
  select other_org_id, 'OTHER-1', 'Other Product', 'product', 100, 'GBP',
    outsider_id, outsider_id
  from _catalog_fixture
  returning id
)
update _catalog_fixture set other_product_id = outsider_product.id from outsider_product;

create or replace function pg_temp.as_user(p_user_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
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

select pg_temp.as_user((select owner_id from _catalog_fixture));
set local role authenticated;

with created_category as (
  insert into public.product_categories (org_id, name, description)
  select org_id, 'Widgets', 'Widget category' from _catalog_fixture
  returning id
)
update _catalog_fixture set category_id = created_category.id from created_category;

with created_product as (
  insert into public.products (
    org_id, sku, name, category_id, product_type, unit_price_cents, currency,
    track_stock, status
  )
  select
    org_id, 'SKU-100', 'Tracked Widget', category_id, 'product', 1250, 'GBP',
    true, 'active'
  from _catalog_fixture
  returning id
)
update _catalog_fixture set product_id = created_product.id from created_product;

select ok(
  (
    select products.stock_qty = 0 and products.track_stock
    from public.products
    join _catalog_fixture on _catalog_fixture.product_id = products.id
  ),
  'tracked products start at stock_qty 0'
);

select lives_ok(
  $$
    select public.adjust_product_stock(
      (select product_id from _catalog_fixture),
      10,
      'opening',
      'initial stock'
    )
  $$,
  'owner can adjust stock through RPC'
);

select ok(
  (
    select products.stock_qty = 10
    from public.products
    join _catalog_fixture on _catalog_fixture.product_id = products.id
  ),
  'stock adjustment updates cached quantity'
);

select ok(
  exists (
    select 1 from public.inventory_movements
    where product_id = (select product_id from _catalog_fixture)
      and quantity_delta = 10
      and reason = 'opening'
  ),
  'stock adjustment appends a ledger movement'
);

select throws_ok(
  $$
    update public.products
    set stock_qty = 999
    where id = (select product_id from _catalog_fixture)
  $$,
  '42501',
  null,
  'authenticated role cannot rewrite stock_qty directly'
);

select throws_ok(
  $$
    insert into public.inventory_movements (
      org_id, product_id, quantity_delta, reason
    )
    select org_id, product_id, 1, 'adjustment' from _catalog_fixture
  $$,
  '42501',
  null,
  'authenticated role cannot insert inventory movements directly'
);

select throws_ok(
  $$
    insert into public.products (
      org_id, sku, name, product_type, unit_price_cents, currency,
      track_stock, status
    )
    select org_id, 'SVC-1', 'Consulting', 'service', 5000, 'GBP',
      true, 'active'
    from _catalog_fixture
  $$,
  '23514',
  null,
  'services cannot track stock'
);

-- Soft-delete as privileged role (same pattern as 0002 contact lifecycle), then
-- prove authenticated callers can reuse the SKU on a new active row.
reset role;

update public.products
set deleted_at = now()
where id = (select product_id from _catalog_fixture);

select pg_temp.as_user((select owner_id from _catalog_fixture));
set local role authenticated;

with recreated as (
  insert into public.products (
    org_id, sku, name, category_id, product_type, unit_price_cents, currency,
    track_stock, status
  )
  select org_id, 'SKU-100', 'Tracked Widget v2', category_id, 'product', 1500, 'GBP',
    true, 'active'
  from _catalog_fixture
  returning id
)
update _catalog_fixture set product_id = recreated.id from recreated;

select ok(
  exists (
    select 1 from public.products
    where id = (select product_id from _catalog_fixture) and sku = 'SKU-100' and deleted_at is null
  ),
  'soft-deleted SKU can be reused on a new active product'
);

select lives_ok(
  $$
    select public.adjust_product_stock(
      (select product_id from _catalog_fixture),
      -3,
      'adjustment'
    )
  $$,
  'negative stock adjustments are atomic with the RPC'
);

select ok(
  (
    select products.stock_qty = -3
    from public.products
    join _catalog_fixture on _catalog_fixture.product_id = products.id
  ),
  'cached stock reflects the negative adjustment'
);

select throws_ok(
  $$
    insert into public.product_categories (org_id, name)
    select org_id, 'Widgets' from _catalog_fixture
  $$,
  '23505',
  null,
  'active category names are unique per organisation'
);

select is_empty(
  $$
    select id from public.products
    where id = (select other_product_id from _catalog_fixture)
  $$,
  'owner cannot read another organisation product'
);

select throws_ok(
  $$
    select public.adjust_product_stock((select other_product_id from _catalog_fixture), 1)
  $$,
  'P0002',
  null,
  'adjust_product_stock cross-tenant UUID is not-found (no oracle)'
);

select ok(
  (
    select
      position('has_org_role' in prosrc)
        < position(E'\n  for update' in lower(prosrc))
    from pg_proc
    where oid = 'public.adjust_product_stock(uuid, numeric, text, text, timestamptz)'::regprocedure
  ),
  'adjust_product_stock checks org role before FOR UPDATE'
);

select ok(
  (
    select
      position('has_org_role' in prosrc)
        < position(E'\n    for update' in lower(prosrc))
    from pg_proc
    where oid = 'public.adjust_product_stock_idempotent(uuid, uuid, numeric, text, text, text, text, text, timestamptz, integer)'::regprocedure
  ),
  'adjust_product_stock_idempotent checks org role before FOR UPDATE'
);

select throws_ok(
  $$
    update public.products
    set track_stock = false
    where id = (select product_id from _catalog_fixture)
  $$,
  '23514',
  null,
  'cannot disable stock tracking after movements or non-zero stock'
);

select throws_ok(
  $$
    select public.adjust_product_stock(
      (select product_id from _catalog_fixture),
      'NaN'::numeric
    )
  $$,
  '22023',
  null,
  'adjust_product_stock rejects NaN quantity deltas'
);

select throws_ok(
  $$
    select public.adjust_product_stock(
      (select product_id from _catalog_fixture),
      'Infinity'::numeric
    )
  $$,
  '22023',
  null,
  'adjust_product_stock rejects Infinity quantity deltas'
);

select lives_ok(
  $$
    insert into public.products (
      org_id, sku, name, product_type, unit_price_cents, currency, track_stock, status
    )
    select org_id, 'FRESH-1', 'Untracked', 'product', 100, 'GBP', false, 'active'
    from _catalog_fixture
  $$,
  'owner can create an untracked product'
);

select lives_ok(
  $$
    update public.products
    set track_stock = true
    where sku = 'FRESH-1'
      and org_id = (select org_id from _catalog_fixture)
      and deleted_at is null
  $$,
  'track_stock may be enabled when there is no ledger and stock is zero/null'
);

select throws_ok(
  $$
    update public.products
    set low_stock_at = 'NaN'::numeric
    where id = (select product_id from _catalog_fixture)
  $$,
  '23514',
  null,
  'products reject NaN low_stock_at at the database boundary'
);

select lives_ok(
  $$
    select public.adjust_product_stock_idempotent(
      (select product_id from _catalog_fixture),
      (select org_id from _catalog_fixture),
      1,
      encode(extensions.digest('idem-1', 'sha256'), 'hex'),
      encode(extensions.digest('req-1', 'sha256'), 'hex'),
      '/api/v1/products/x/adjust-stock',
      'adjustment'
    )
  $$,
  'idempotent adjust claims and applies in one transaction'
);

select ok(
  (
    select (public.adjust_product_stock_idempotent(
      (select product_id from _catalog_fixture),
      (select org_id from _catalog_fixture),
      1,
      encode(extensions.digest('idem-1', 'sha256'), 'hex'),
      encode(extensions.digest('req-1', 'sha256'), 'hex'),
      '/api/v1/products/x/adjust-stock',
      'adjustment'
    ) ->> 'replay')::boolean
  ),
  'idempotent adjust replays the stored response without a second movement'
);

select throws_ok(
  $$
    select public.adjust_product_stock_idempotent(
      (select product_id from _catalog_fixture),
      (select org_id from _catalog_fixture),
      2,
      encode(extensions.digest('idem-1', 'sha256'), 'hex'),
      encode(extensions.digest('req-2', 'sha256'), 'hex'),
      '/api/v1/products/x/adjust-stock',
      'adjustment'
    )
  $$,
  '23505',
  null,
  'idempotent adjust rejects key reuse with a different payload'
);

select throws_ok(
  $$
    insert into public.api_idempotency_keys (
      org_id, actor_type, actor_id, idempotency_key_hash, route, request_hash, expires_at
    )
    select
      org_id,
      'user',
      owner_id,
      encode(extensions.digest('forged', 'sha256'), 'hex'),
      '/api/v1/products/x/adjust-stock',
      encode(extensions.digest('forged-req', 'sha256'), 'hex'),
      now() + interval '1 day'
    from _catalog_fixture
  $$,
  '42501',
  null,
  'authenticated role cannot insert api_idempotency_keys directly'
);

select throws_ok(
  $$
    update public.api_idempotency_keys
    set response_status = 200,
        response_body = '{"status":200,"body":{"forged":true}}'::jsonb
    where idempotency_key_hash = encode(extensions.digest('idem-1', 'sha256'), 'hex')
  $$,
  '42501',
  null,
  'authenticated role cannot update api_idempotency_keys directly'
);

-- Expire the key as a privileged fixture (clients have no table grants;
-- the reclaim path lives inside the security-definer RPC).
reset role;
update public.api_idempotency_keys
set expires_at = now() - interval '1 hour'
where idempotency_key_hash = encode(extensions.digest('idem-1', 'sha256'), 'hex');

select pg_temp.as_user((select owner_id from _catalog_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.adjust_product_stock_idempotent(
      (select product_id from _catalog_fixture),
      (select org_id from _catalog_fixture),
      1,
      encode(extensions.digest('idem-1', 'sha256'), 'hex'),
      encode(extensions.digest('req-3', 'sha256'), 'hex'),
      '/api/v1/products/x/adjust-stock',
      'adjustment'
    )
  $$,
  'expired idempotency keys can be reclaimed'
);

select ok(
  (
    select count(*) = 3
    from public.inventory_movements
    where product_id = (select product_id from _catalog_fixture)
  ),
  'replay did not duplicate movements; reclaim applied one new delta'
);

-- Claim, soft-delete, then prove replay still returns the stored success.
select lives_ok(
  $$
    select public.adjust_product_stock_idempotent(
      (select product_id from _catalog_fixture),
      (select org_id from _catalog_fixture),
      1,
      encode(extensions.digest('idem-soft', 'sha256'), 'hex'),
      encode(extensions.digest('req-soft', 'sha256'), 'hex'),
      '/api/v1/products/x/adjust-stock',
      'adjustment'
    )
  $$,
  'idempotent adjust before soft-delete establishes a completed claim'
);

reset role;
update public.products
set deleted_at = now()
where id = (select product_id from _catalog_fixture);

select pg_temp.as_user((select owner_id from _catalog_fixture));
set local role authenticated;

select ok(
  (
    select (public.adjust_product_stock_idempotent(
      (select product_id from _catalog_fixture),
      (select org_id from _catalog_fixture),
      1,
      encode(extensions.digest('idem-soft', 'sha256'), 'hex'),
      encode(extensions.digest('req-soft', 'sha256'), 'hex'),
      '/api/v1/products/x/adjust-stock',
      'adjustment'
    ) ->> 'replay')::boolean
  ),
  'idempotent adjust replays stored success after product soft-delete'
);

select throws_ok(
  $$
    select public.adjust_product_stock_idempotent(
      (select product_id from _catalog_fixture),
      (select org_id from _catalog_fixture),
      1,
      encode(extensions.digest('idem-soft-new', 'sha256'), 'hex'),
      encode(extensions.digest('req-soft-new', 'sha256'), 'hex'),
      '/api/v1/products/x/adjust-stock',
      'adjustment'
    )
  $$,
  'P0002',
  null,
  'new idempotent claims are rejected after product soft-delete'
);

reset role;
update public.products
set deleted_at = null
where id = (select product_id from _catalog_fixture);

select pg_temp.as_user((select owner_id from _catalog_fixture));
set local role authenticated;

select throws_ok(
  $$
    update public.product_categories
    set deleted_at = now()
    where id = (select category_id from _catalog_fixture)
  $$,
  '23514',
  null,
  'cannot soft-delete a category while active products reference it'
);

select pg_temp.as_user((select billing_id from _catalog_fixture));
set local role authenticated;

select ok(
  exists (
    select 1 from public.products where id = (select product_id from _catalog_fixture)
  ),
  'billing role can read products'
);

select throws_ok(
  $$
    insert into public.products (
      org_id, sku, name, product_type, unit_price_cents, currency
    )
    select org_id, 'BILL-1', 'Nope', 'product', 100, 'GBP'
    from _catalog_fixture
  $$,
  '42501',
  null,
  'billing role cannot insert products'
);

select throws_ok(
  $$
    select public.adjust_product_stock((select product_id from _catalog_fixture), 1, 'adjustment')
  $$,
  '42501',
  null,
  'billing role cannot adjust stock'
);

select pg_temp.as_user((select readonly_id from _catalog_fixture));

select ok(
  exists (
    select 1 from public.product_categories
    where id = (select category_id from _catalog_fixture)
  ),
  'readonly role can read product categories'
);

select throws_ok(
  $$
    insert into public.product_categories (org_id, name)
    select org_id, 'Readonly Category' from _catalog_fixture
  $$,
  '42501',
  null,
  'readonly role cannot insert product categories'
);

reset role;

select * from finish();

rollback;

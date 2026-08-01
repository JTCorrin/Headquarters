begin;

select plan(6);

select ok(
  has_function_privilege(
    'authenticated',
    'public.soft_delete_product(uuid, uuid, integer)',
    'execute'
  ),
  'authenticated users can execute soft_delete_product'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.soft_delete_product(uuid, uuid, integer)',
    'execute'
  ),
  'anonymous users cannot execute soft_delete_product'
);

create temporary table _product_del_fixture (
  owner_id uuid,
  outsider_id uuid,
  org_id uuid,
  product_id uuid,
  product_version integer
) on commit drop;

grant all on table _product_del_fixture to authenticated;

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
    extensions.crypt('product-del-password', extensions.gen_salt('bf')),
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

insert into _product_del_fixture (owner_id, outsider_id)
values (
  pg_temp.make_auth_user('product-del-owner@example.test', 'Product Del Owner'),
  pg_temp.make_auth_user('product-del-outsider@example.test', 'Product Del Outsider')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Product Del Org',
    'product-del-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
)
update _product_del_fixture
set org_id = created_org.id
from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active'
from _product_del_fixture;

with created_product as (
  insert into public.products (
    org_id,
    sku,
    name,
    product_type,
    unit_price_cents,
    currency,
    status,
    created_by,
    updated_by
  )
  select
    org_id,
    'DEL-1',
    'Deletable Product',
    'product',
    1000,
    'GBP',
    'active',
    owner_id,
    owner_id
  from _product_del_fixture
  returning id, version
)
update _product_del_fixture
set
  product_id = created_product.id,
  product_version = created_product.version
from created_product;

select pg_temp.as_user((select owner_id from _product_del_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.soft_delete_product(
      (select product_id from _product_del_fixture),
      (select org_id from _product_del_fixture),
      (select product_version from _product_del_fixture)
    )
  $$,
  'owner can soft-delete a product via RPC'
);

select is(
  (
    select count(*)::integer
    from public.products
    where id = (select product_id from _product_del_fixture)
  ),
  0,
  'soft-deleted products are hidden by RLS'
);

select throws_ok(
  $$
    select public.soft_delete_product(
      (select product_id from _product_del_fixture),
      (select org_id from _product_del_fixture),
      (select product_version from _product_del_fixture)
    )
  $$,
  'P0002',
  null,
  'soft_delete_product returns not-found after delete'
);

reset role;
with recreated as (
  insert into public.products (
    org_id,
    sku,
    name,
    product_type,
    unit_price_cents,
    currency,
    status,
    created_by,
    updated_by
  )
  select
    org_id,
    'DEL-2',
    'Outsider Target Product',
    'product',
    500,
    'GBP',
    'active',
    owner_id,
    owner_id
  from _product_del_fixture
  returning id, version
)
update _product_del_fixture
set
  product_id = recreated.id,
  product_version = recreated.version
from recreated;

select pg_temp.as_user((select outsider_id from _product_del_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.soft_delete_product(
      (select product_id from _product_del_fixture),
      (select org_id from _product_del_fixture),
      (select product_version from _product_del_fixture)
    )
  $$,
  '42501',
  null,
  'outsiders cannot soft-delete another organisation product'
);

reset role;

select * from finish();

rollback;

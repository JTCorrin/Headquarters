begin;

select plan(8);

select ok(
  has_function_privilege(
    'authenticated',
    'public.send_quote(uuid, uuid, integer)',
    'execute'
  ),
  'authenticated can execute send_quote'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.reject_quote(uuid, uuid, integer)',
    'execute'
  ),
  'authenticated can execute reject_quote'
);

create temporary table _a3_fixture (
  owner_id uuid,
  org_id uuid,
  client_id uuid,
  product_id uuid,
  tax_rate_id uuid,
  send_quote_id uuid,
  send_quote_version integer,
  reject_quote_id uuid,
  reject_quote_version integer
) on commit drop;

grant all on table _a3_fixture to authenticated;

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
    extensions.crypt('a3-test-password', extensions.gen_salt('bf')),
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

insert into _a3_fixture (owner_id)
values (pg_temp.make_auth_user('a3-owner@example.test', 'A3 Owner'));

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'A3 Quote Org',
    'a3-quote-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
)
update _a3_fixture
set org_id = created_org.id
from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _a3_fixture;

with created_client as (
  insert into public.clients (org_id, name, status, created_by, updated_by)
  select org_id, 'A3 Client', 'active', owner_id, owner_id from _a3_fixture
  returning id
)
update _a3_fixture
set client_id = created_client.id
from created_client;

with created_tax as (
  insert into public.tax_rates (org_id, name, rate_percent, is_default, active)
  select org_id, 'VAT 20%', 20, true, true from _a3_fixture
  returning id
)
update _a3_fixture
set tax_rate_id = created_tax.id
from created_tax;

with created_product as (
  insert into public.products (
    org_id, sku, name, product_type, unit_price_cents, currency,
    tax_rate_id, track_stock, status
  )
  select
    org_id, 'A3-P', 'A3 Product', 'service', 10000, 'GBP',
    tax_rate_id, false, 'active'
  from _a3_fixture
  returning id
)
update _a3_fixture
set product_id = created_product.id
from created_product;

select pg_temp.as_user((select owner_id from _a3_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.create_quote_draft(
      (select org_id from _a3_fixture),
      jsonb_build_object(
        'title', 'Send me',
        'client_id', (select client_id from _a3_fixture)
      ),
      jsonb_build_array(
        jsonb_build_object(
          'product_id', (select product_id from _a3_fixture),
          'quantity', 1,
          'position', 0
        )
      )
    )
  $$,
  'owner can create draft quote for send'
);

update _a3_fixture
set
  send_quote_id = quotes.id,
  send_quote_version = quotes.version
from public.quotes
where quotes.org_id = _a3_fixture.org_id
  and quotes.title = 'Send me'
  and quotes.deleted_at is null;

select lives_ok(
  $$
    select public.send_quote(
      (select send_quote_id from _a3_fixture),
      (select org_id from _a3_fixture),
      (select send_quote_version from _a3_fixture)
    )
  $$,
  'owner can send a draft quote'
);

select is(
  (
    select status from public.quotes
    where id = (select send_quote_id from _a3_fixture)
  ),
  'sent',
  'send_quote moves quote to sent'
);

select throws_ok(
  $$
    select public.send_quote(
      (select send_quote_id from _a3_fixture),
      (select org_id from _a3_fixture),
      (select version from public.quotes where id = (select send_quote_id from _a3_fixture))
    )
  $$,
  '22023',
  null,
  'send_quote rejects non-draft quotes'
);

select lives_ok(
  $$
    select public.create_quote_draft(
      (select org_id from _a3_fixture),
      jsonb_build_object(
        'title', 'Reject me',
        'client_id', (select client_id from _a3_fixture)
      ),
      jsonb_build_array(
        jsonb_build_object(
          'product_id', (select product_id from _a3_fixture),
          'quantity', 1,
          'position', 0
        )
      )
    )
  $$,
  'owner can create draft quote for reject'
);

update _a3_fixture
set
  reject_quote_id = quotes.id,
  reject_quote_version = quotes.version
from public.quotes
where quotes.org_id = _a3_fixture.org_id
  and quotes.title = 'Reject me'
  and quotes.deleted_at is null;

select lives_ok(
  $$
    select public.reject_quote(
      (select reject_quote_id from _a3_fixture),
      (select org_id from _a3_fixture),
      (select reject_quote_version from _a3_fixture)
    )
  $$,
  'owner can reject a draft quote'
);

select is(
  (
    select status from public.quotes
    where id = (select reject_quote_id from _a3_fixture)
  ),
  'rejected',
  'reject_quote moves quote to rejected'
);

select * from finish();
rollback;

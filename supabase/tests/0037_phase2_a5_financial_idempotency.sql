begin;

select plan(11);

select ok(
  has_function_privilege(
    'authenticated',
    'public.send_invoice_idempotent(uuid, uuid, integer, text, text, text, integer)',
    'execute'
  ),
  'authenticated can execute send_invoice_idempotent'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.void_invoice_idempotent(uuid, uuid, integer, text, text, text, text, integer)',
    'execute'
  ),
  'authenticated can execute void_invoice_idempotent'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.accept_quote_idempotent(uuid, uuid, integer, text, text, text, integer)',
    'execute'
  ),
  'authenticated can execute accept_quote_idempotent'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.receive_bill_idempotent(uuid, uuid, integer, text, text, text, integer)',
    'execute'
  ),
  'authenticated can execute receive_bill_idempotent'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.void_bill_idempotent(uuid, uuid, integer, text, text, text, text, integer)',
    'execute'
  ),
  'authenticated can execute void_bill_idempotent'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.reverse_payment_idempotent(uuid, uuid, integer, text, text, text, text, integer)',
    'execute'
  ),
  'authenticated can execute reverse_payment_idempotent (pre-existing A5 surface)'
);

create temporary table _a5_fixture (
  owner_id uuid,
  org_id uuid,
  client_id uuid,
  invoice_id uuid,
  invoice_version integer,
  first_body jsonb,
  replay_body jsonb
) on commit drop;

grant all on table _a5_fixture to authenticated;

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
    extensions.crypt('a5-test-password', extensions.gen_salt('bf')),
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

insert into _a5_fixture (owner_id)
values (pg_temp.make_auth_user('a5-owner@example.test', 'A5 Owner'));

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'A5 Financial Org',
    'a5-fin-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
)
update _a5_fixture
set org_id = created_org.id
from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _a5_fixture;

with created_client as (
  insert into public.clients (org_id, name, status, created_by, updated_by)
  select org_id, 'A5 Client', 'active', owner_id, owner_id from _a5_fixture
  returning id
)
update _a5_fixture
set client_id = created_client.id
from created_client;

select pg_temp.as_user((select owner_id from _a5_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.create_invoice_draft(
      (select org_id from _a5_fixture),
      jsonb_build_object('client_id', (select client_id from _a5_fixture)),
      jsonb_build_array(
        jsonb_build_object(
          'description', 'A5 line',
          'quantity', 1,
          'unit_price_cents', 5000,
          'tax_rate_percent', 0,
          'position', 0
        )
      )
    )
  $$,
  'owner can create draft invoice for send idempotency'
);

update _a5_fixture
set
  invoice_id = invoices.id,
  invoice_version = invoices.version
from public.invoices
where invoices.org_id = _a5_fixture.org_id
  and invoices.status = 'draft'
  and invoices.deleted_at is null;

with sent as (
  select public.send_invoice_idempotent(
    (select invoice_id from _a5_fixture),
    (select org_id from _a5_fixture),
    (select invoice_version from _a5_fixture),
    repeat('a', 64),
    repeat('b', 64),
    '/api/v1/invoices/' || (select invoice_id::text from _a5_fixture) || '/send'
  ) as body
)
update _a5_fixture
set first_body = sent.body
from sent;

select is(
  (select first_body ->> 'replay' from _a5_fixture),
  'false',
  'first send_invoice_idempotent stores a non-replay response'
);

select is(
  (
    select status from public.invoices
    where id = (select invoice_id from _a5_fixture)
  ),
  'sent',
  'idempotent send moves invoice to sent'
);

with replayed as (
  select public.send_invoice_idempotent(
    (select invoice_id from _a5_fixture),
    (select org_id from _a5_fixture),
    (select invoice_version from _a5_fixture),
    repeat('a', 64),
    repeat('b', 64),
    '/api/v1/invoices/' || (select invoice_id::text from _a5_fixture) || '/send'
  ) as body
)
update _a5_fixture
set replay_body = replayed.body
from replayed;

select is(
  (select replay_body ->> 'replay' from _a5_fixture),
  'true',
  'second send with same Idempotency-Key replays'
);

select throws_ok(
  $$
    select public.send_invoice_idempotent(
      (select invoice_id from _a5_fixture),
      (select org_id from _a5_fixture),
      (select invoice_version from _a5_fixture),
      repeat('a', 64),
      repeat('c', 64),
      '/api/v1/invoices/' || (select invoice_id::text from _a5_fixture) || '/send'
    )
  $$,
  '23505',
  null,
  'same Idempotency-Key with different request hash is rejected'
);

select * from finish();
rollback;

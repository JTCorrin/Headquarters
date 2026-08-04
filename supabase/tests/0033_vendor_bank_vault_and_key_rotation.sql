-- S3 vendor bank vault + S4 Supabase Vault encryption key guards.

begin;

select plan(18);

select ok(
  exists (
    select 1 from pg_extension where extname = 'supabase_vault'
  ),
  'supabase_vault extension is installed'
);

select has_table('private', 'encryption_key_meta', 'encryption_key_meta exists');

select ok(
  not exists (
    select 1 from information_schema.tables
    where table_schema = 'private' and table_name = 'encryption_keys'
  ),
  'private.encryption_keys was removed (key lives in Vault)'
);

select ok(
  exists (
    select 1 from vault.secrets where name = 'crm_enc_key_v1'
  ),
  'Vault holds crm_enc_key_v1'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.set_vendor_bank_details(uuid, uuid, text, integer)',
    'execute'
  ),
  'authenticated can execute set_vendor_bank_details'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.read_vendor_bank_details(uuid, uuid)',
    'execute'
  ),
  'authenticated can execute read_vendor_bank_details'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.rotate_org_encryption_key(uuid)',
    'execute'
  ),
  'authenticated can execute rotate_org_encryption_key'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.rotate_encryption_key()',
    'execute'
  ),
  'authenticated cannot execute private.rotate_encryption_key'
);

select ok(
  (
    select count(*)::integer
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'vendors'
      and column_name = 'bank_details_secret_ref'
      and grantee = 'authenticated'
      and privilege_type = 'SELECT'
  ) = 0,
  'authenticated cannot select bank_details_secret_ref'
);

select ok(
  (
    select count(*)::integer
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'vendors'
      and column_name = 'bank_details_encrypted'
      and grantee = 'authenticated'
      and privilege_type in ('INSERT', 'UPDATE')
  ) = 0,
  'authenticated cannot write bank_details_encrypted'
);

create temporary table _vault_fixture (
  owner_id uuid,
  member_id uuid,
  outsider_id uuid,
  org_id uuid,
  other_org_id uuid,
  vendor_id uuid,
  other_vendor_id uuid
) on commit drop;

grant all on table _vault_fixture to authenticated;

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
    p_email, extensions.crypt('vault-test', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('display_name', p_name), now(), now(), '', '', '', ''
  );
  return created_id;
end;
$$;

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

insert into _vault_fixture (owner_id, member_id, outsider_id)
values (
  pg_temp.make_auth_user('vault-owner@example.test', 'Vault Owner'),
  pg_temp.make_auth_user('vault-member@example.test', 'Vault Member'),
  pg_temp.make_auth_user('vault-outsider@example.test', 'Vault Outsider')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Vault Org',
    'vault-org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
),
other_org as (
  insert into public.organisations (name, slug, country_code)
  values (
    'Other Vault Org',
    'other-vault-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB'
  )
  returning id
)
update _vault_fixture
set org_id = created_org.id, other_org_id = other_org.id
from created_org, other_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _vault_fixture;
insert into public.memberships (org_id, user_id, role, status)
select org_id, member_id, 'member', 'active' from _vault_fixture;
insert into public.memberships (org_id, user_id, role, status)
select other_org_id, outsider_id, 'owner', 'active' from _vault_fixture;

select pg_temp.as_user((select owner_id from _vault_fixture));
set local role authenticated;

with created_vendor as (
  insert into public.vendors (org_id, name, status, default_currency)
  select org_id, 'Vault Vendor', 'active', 'GBP' from _vault_fixture
  returning id
)
update _vault_fixture set vendor_id = created_vendor.id from created_vendor;

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);

with outsider_vendor as (
  insert into public.vendors (
    org_id, name, status, default_currency, created_by, updated_by
  )
  select other_org_id, 'Other Vendor', 'active', 'GBP', outsider_id, outsider_id
  from _vault_fixture
  returning id
)
update _vault_fixture set other_vendor_id = outsider_vendor.id from outsider_vendor;

select pg_temp.as_user((select owner_id from _vault_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.set_vendor_bank_details(
      (select org_id from _vault_fixture),
      (select vendor_id from _vault_fixture),
      'IBAN GB00 TEST 1234',
      1
    )
  $$,
  'owner can store vendor bank details in the vault'
);

select is(
  (
    select public.read_vendor_bank_details(
      (select org_id from _vault_fixture),
      (select vendor_id from _vault_fixture)
    ) ->> 'bank_details'
  ),
  'IBAN GB00 TEST 1234',
  'owner can read vault-backed vendor bank details'
);

select is(
  (
    select public.read_vendor_bank_details(
      (select org_id from _vault_fixture),
      (select vendor_id from _vault_fixture)
    ) ->> 'bank_details_configured'
  ),
  'true',
  'read reports bank_details_configured'
);

select pg_temp.as_user((select member_id from _vault_fixture));

select is(
  (
    select public.read_vendor_bank_details(
      (select org_id from _vault_fixture),
      (select vendor_id from _vault_fixture)
    ) ->> 'bank_details'
  ),
  'IBAN GB00 TEST 1234',
  'member can read vendor bank details in-org'
);

select throws_ok(
  $$
    select public.set_vendor_bank_details(
      (select org_id from _vault_fixture),
      (select other_vendor_id from _vault_fixture),
      'stolen',
      1
    )
  $$,
  'P0002',
  null,
  'cross-org vendor bank write is not-found'
);

select throws_ok(
  $$
    select pg_temp.as_user(outsider_id) from _vault_fixture;
    select public.read_vendor_bank_details(
      (select org_id from _vault_fixture),
      (select vendor_id from _vault_fixture)
    )
  $$,
  '42501',
  null,
  'outsider cannot read vendor bank details'
);

select pg_temp.as_user((select owner_id from _vault_fixture));

select ok(
  (
    select (public.rotate_org_encryption_key((select org_id from _vault_fixture))
      ->> 'active_key_name') ~ '^crm_enc_key_v[2-9]'
  ),
  'owner can rotate Vault key; active name advances past v1'
);

select is(
  (
    select public.read_vendor_bank_details(
      (select org_id from _vault_fixture),
      (select vendor_id from _vault_fixture)
    ) ->> 'bank_details'
  ),
  'IBAN GB00 TEST 1234',
  'vendor bank details survive key rotation'
);

reset role;

select * from finish();

rollback;

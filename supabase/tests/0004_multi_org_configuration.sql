begin;

select plan(30);

select has_column('public', 'organisations', 'theme_default', 'organisations.theme_default exists');
select has_column('public', 'organisations', 'version', 'organisations.version exists');
select has_column('public', 'profiles', 'theme_preference', 'profiles.theme_preference exists');
select has_table('public', 'tax_rates', 'tax_rates table exists');

create temporary table _orgcfg_fixture (
  owner_id uuid,
  admin_id uuid,
  member_id uuid,
  billing_id uuid,
  readonly_id uuid,
  outsider_id uuid,
  suspended_id uuid,
  org_a uuid,
  org_b uuid,
  tax_rate_id uuid
) on commit drop;

grant all on table _orgcfg_fixture to authenticated;

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
    p_email, extensions.crypt('orgcfg-test', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('display_name', p_name), now(), now(), '', '', '', ''
  );
  return created_id;
end;
$$;

insert into _orgcfg_fixture (
  owner_id, admin_id, member_id, billing_id, readonly_id, outsider_id, suspended_id
) values (
  pg_temp.make_auth_user('orgcfg-owner@example.test', 'Owner'),
  pg_temp.make_auth_user('orgcfg-admin@example.test', 'Admin'),
  pg_temp.make_auth_user('orgcfg-member@example.test', 'Member'),
  pg_temp.make_auth_user('orgcfg-billing@example.test', 'Billing'),
  pg_temp.make_auth_user('orgcfg-readonly@example.test', 'Readonly'),
  pg_temp.make_auth_user('orgcfg-outsider@example.test', 'Outsider'),
  pg_temp.make_auth_user('orgcfg-suspended@example.test', 'Suspended')
);

with org_a as (
  insert into public.organisations (name, slug, country_code, default_currency, theme_default)
  values (
    'Alpha Org',
    'alpha-org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP',
    'system'
  )
  returning id
),
org_b as (
  insert into public.organisations (name, slug, country_code, default_currency, theme_default)
  values (
    'Beta Org',
    'beta-org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'US',
    'USD',
    'dark'
  )
  returning id
)
update _orgcfg_fixture
set org_a = org_a.id, org_b = org_b.id
from org_a, org_b;

insert into public.memberships (org_id, user_id, role, status)
select org_a, owner_id, 'owner', 'active' from _orgcfg_fixture;
insert into public.memberships (org_id, user_id, role, status)
select org_a, admin_id, 'admin', 'active' from _orgcfg_fixture;
insert into public.memberships (org_id, user_id, role, status)
select org_a, member_id, 'member', 'active' from _orgcfg_fixture;
insert into public.memberships (org_id, user_id, role, status)
select org_a, billing_id, 'billing', 'active' from _orgcfg_fixture;
insert into public.memberships (org_id, user_id, role, status)
select org_a, readonly_id, 'readonly', 'active' from _orgcfg_fixture;
insert into public.memberships (org_id, user_id, role, status, suspended_at)
select org_a, suspended_id, 'member', 'suspended', now() from _orgcfg_fixture;
insert into public.memberships (org_id, user_id, role, status)
select org_b, outsider_id, 'owner', 'active' from _orgcfg_fixture;
-- Owner is multi-org: owner of A, member of B (outsider remains sole owner of B).
insert into public.memberships (org_id, user_id, role, status)
select org_b, owner_id, 'member', 'active' from _orgcfg_fixture;

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

select pg_temp.as_user((select owner_id from _orgcfg_fixture));
set local role authenticated;

select ok(
  (
    select count(*) = 2
    from public.organisations
    where id in (select org_a from _orgcfg_fixture union all select org_b from _orgcfg_fixture)
  ),
  'owner can discover both organisations they actively belong to'
);

select lives_ok(
  $$
    select public.create_organisation(
      'Gamma Org',
      'gamma-org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
      'GB',
      'EUR',
      'Europe/London',
      'en-GB'
    )
  $$,
  'create_organisation atomically creates an organisation'
);

select ok(
  exists (
    select 1
    from public.memberships
    where user_id = (select owner_id from _orgcfg_fixture)
      and role = 'owner'
      and status = 'active'
      and org_id in (
        select id from public.organisations where name = 'Gamma Org'
      )
  ),
  'create_organisation makes the caller the active owner'
);

select lives_ok(
  $$
    update public.organisations
    set theme_default = 'light', timezone = 'Europe/Paris'
    where id = (select org_a from _orgcfg_fixture)
  $$,
  'owner can update organisation configuration'
);

select ok(
  (
    select version = 2 and theme_default = 'light'
    from public.organisations
    where id = (select org_a from _orgcfg_fixture)
  ),
  'organisation version increments on configuration update'
);

with created as (
  insert into public.tax_rates (org_id, name, rate_percent, is_default, active)
  select org_a, 'VAT 20%', 20, true, true
  from _orgcfg_fixture
  returning id
)
update _orgcfg_fixture set tax_rate_id = created.id from created;

select ok(
  (
    select is_default and active
    from public.tax_rates
    where id = (select tax_rate_id from _orgcfg_fixture)
  ),
  'owner can create a default tax rate'
);

select lives_ok(
  $$
    insert into public.tax_rates (org_id, name, rate_percent, is_default, active)
    select org_a, 'Zero', 0, true, true from _orgcfg_fixture
  $$,
  'setting a new default tax rate is allowed'
);

select ok(
  (
    select count(*) = 1
    from public.tax_rates
    where org_id = (select org_a from _orgcfg_fixture)
      and is_default
      and deleted_at is null
  ),
  'at most one active default tax rate remains per organisation'
);

select ok(
  (
    select not is_default
    from public.tax_rates
    where id = (select tax_rate_id from _orgcfg_fixture)
  ),
  'previous default tax rate is cleared when a new default is set'
);

select throws_ok(
  $$
    insert into public.tax_rates (org_id, name, rate_percent, is_default, active)
    select org_a, 'NaN rate', 'NaN'::numeric, false, true from _orgcfg_fixture
  $$,
  '23514',
  null,
  'tax rates reject non-finite rate_percent'
);

select throws_ok(
  $$
    update public.organisations
    set theme_default = 'neon'
    where id = (select org_a from _orgcfg_fixture)
  $$,
  '23514',
  null,
  'organisations reject invalid theme_default values'
);

select lives_ok(
  $$
    update public.profiles
    set theme_preference = 'dark'
    where id = (select owner_id from _orgcfg_fixture)
  $$,
  'owner can set a personal theme preference'
);

select is_empty(
  $$
    select id from public.tax_rates
    where org_id = (select org_b from _orgcfg_fixture)
  $$,
  'org B has no tax rates visible (cross-org isolation of seeded rates)'
);

reset role;
update public.organisations
set deleted_at = now()
where id = (select org_a from _orgcfg_fixture);

select pg_temp.as_user((select owner_id from _orgcfg_fixture));
set local role authenticated;

select is_empty(
  $$
    select id from public.organisations where id = (select org_a from _orgcfg_fixture)
  $$,
  'deleted organisations never appear to members'
);

reset role;
update public.organisations
set deleted_at = null
where id = (select org_a from _orgcfg_fixture);

select pg_temp.as_user((select suspended_id from _orgcfg_fixture));
set local role authenticated;

select is_empty(
  $$
    select id from public.organisations where id = (select org_a from _orgcfg_fixture)
  $$,
  'suspended memberships cannot discover the organisation'
);

select throws_ok(
  $$
    insert into public.tax_rates (org_id, name, rate_percent)
    select org_a, 'Suspended Rate', 5 from _orgcfg_fixture
  $$,
  '42501',
  null,
  'suspended memberships cannot insert tax rates'
);

select pg_temp.as_user((select outsider_id from _orgcfg_fixture));

select is_empty(
  $$
    select id from public.organisations where id = (select org_a from _orgcfg_fixture)
  $$,
  'outsiders cannot read another organisation'
);

update public.organisations
set theme_default = 'dark'
where id = (select org_a from _orgcfg_fixture);
reset role;
select ok(
  (
    select theme_default = 'light'
    from public.organisations
    where id = (select org_a from _orgcfg_fixture)
  ),
  'organisation theme remains light after outsider update attempt'
);

select pg_temp.as_user((select member_id from _orgcfg_fixture));
set local role authenticated;

select ok(
  exists (
    select 1 from public.tax_rates
    where org_id = (select org_a from _orgcfg_fixture)
  ),
  'members can read tax rates'
);

select throws_ok(
  $$
    insert into public.tax_rates (org_id, name, rate_percent)
    select org_a, 'Member Rate', 7 from _orgcfg_fixture
  $$,
  '42501',
  null,
  'members cannot insert tax rates'
);

update public.organisations
set theme_default = 'dark'
where id = (select org_a from _orgcfg_fixture);
reset role;
select ok(
  (
    select theme_default = 'light'
    from public.organisations
    where id = (select org_a from _orgcfg_fixture)
  ),
  'members cannot update organisation configuration'
);

select pg_temp.as_user((select billing_id from _orgcfg_fixture));
set local role authenticated;

select ok(
  exists (
    select 1 from public.organisations where id = (select org_a from _orgcfg_fixture)
  ),
  'billing role can read organisation configuration'
);

update public.organisations
set default_currency = 'USD'
where id = (select org_a from _orgcfg_fixture);
reset role;
select ok(
  (
    select default_currency = 'GBP'
    from public.organisations
    where id = (select org_a from _orgcfg_fixture)
  ),
  'billing role cannot update organisation configuration'
);

select pg_temp.as_user((select readonly_id from _orgcfg_fixture));
set local role authenticated;

select ok(
  exists (
    select 1 from public.tax_rates
    where org_id = (select org_a from _orgcfg_fixture)
      and deleted_at is null
  ),
  'readonly role can read tax rates'
);

update public.tax_rates
set name = 'Nope'
where org_id = (select org_a from _orgcfg_fixture);
reset role;
select ok(
  not exists (
    select 1 from public.tax_rates
    where org_id = (select org_a from _orgcfg_fixture)
      and name = 'Nope'
      and deleted_at is null
  ),
  'readonly role cannot update tax rates'
);

select pg_temp.as_user((select admin_id from _orgcfg_fixture));
set local role authenticated;

select lives_ok(
  $$
    update public.organisations
    set locale = 'en-US'
    where id = (select org_a from _orgcfg_fixture)
  $$,
  'admin can update organisation configuration'
);

reset role;

select * from finish();
rollback;

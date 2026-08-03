begin;

select plan(14);

select ok(
  exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'audit_events'
  ),
  'audit_events table exists'
);

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname = 'append_audit_event'
  ),
  'private.append_audit_event helper exists'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.append_audit_event(uuid, text, uuid, text, text, uuid, uuid, inet, text, jsonb, jsonb, jsonb)',
    'execute'
  ),
  'authenticated cannot call private.append_audit_event directly'
);

select ok(
  not exists (
    select 1
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'audit_events'
      and grantee = 'authenticated'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ),
  'authenticated users cannot mutate audit_events directly'
);

select ok(
  has_table_privilege('authenticated', 'public.audit_events', 'select'),
  'authenticated users can select audit_events (RLS still applies)'
);

create temporary table _audit_fixture (
  owner_id uuid,
  admin_id uuid,
  member_id uuid,
  org_id uuid,
  tax_rate_id uuid
) on commit drop;

grant all on table _audit_fixture to authenticated;

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
    extensions.crypt('audit-foundation-password', extensions.gen_salt('bf')),
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

do $$
declare
  owner_id uuid;
  admin_id uuid;
  member_id uuid;
  org_id uuid;
begin
  owner_id := pg_temp.make_auth_user('audit-owner@example.test', 'Audit Owner');
  admin_id := pg_temp.make_auth_user('audit-admin@example.test', 'Audit Admin');
  member_id := pg_temp.make_auth_user('audit-member@example.test', 'Audit Member');

  perform pg_temp.as_user(owner_id);
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Audit Org',
    'audit-org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id into org_id;

  insert into public.memberships (org_id, user_id, role, status)
  values
    (org_id, owner_id, 'owner', 'active'),
    (org_id, admin_id, 'admin', 'active'),
    (org_id, member_id, 'member', 'active');

  insert into _audit_fixture (owner_id, admin_id, member_id, org_id)
  values (owner_id, admin_id, member_id, org_id);
end;
$$;

select is(
  (
    select count(*)::integer
    from public.audit_events
    where org_id = (select org_id from _audit_fixture)
      and action = 'org.created'
  ),
  1,
  'org.created audit row written on organisation insert'
);

select pg_temp.as_user((select owner_id from _audit_fixture));
set local role authenticated;

select lives_ok(
  $$
    update public.organisations
    set name = 'Audit Org Renamed', version = version + 1
    where id = (select org_id from _audit_fixture)
  $$,
  'owner can rename organisation'
);

select is(
  (
    select count(*)::integer
    from public.audit_events
    where org_id = (select org_id from _audit_fixture)
      and action = 'org.name_changed'
  ),
  1,
  'org.name_changed written on name update'
);

select lives_ok(
  $$
    update public.organisations
    set theme_default = 'dark', version = version + 1
    where id = (select org_id from _audit_fixture)
  $$,
  'owner can patch organisation config'
);

select is(
  (
    select count(*)::integer
    from public.audit_events
    where org_id = (select org_id from _audit_fixture)
      and action = 'org.config_updated'
  ),
  1,
  'org.config_updated written on non-name config update'
);

select lives_ok(
  $$
    insert into public.tax_rates (org_id, name, rate_percent, is_default, active)
    values (
      (select org_id from _audit_fixture),
      'Audit VAT',
      20,
      true,
      true
    )
  $$,
  'owner can create a tax rate'
);

update _audit_fixture
set tax_rate_id = (
  select id from public.tax_rates
  where org_id = (select org_id from _audit_fixture)
    and name = 'Audit VAT'
  order by created_at desc
  limit 1
);

select is(
  (
    select count(*)::integer
    from public.audit_events
    where org_id = (select org_id from _audit_fixture)
      and action = 'org.tax_rate_created'
      and resource_id = (select tax_rate_id from _audit_fixture)
  ),
  1,
  'org.tax_rate_created written on tax rate insert'
);

reset role;
select pg_temp.as_user((select admin_id from _audit_fixture));
set local role authenticated;

select isnt_empty(
  $$
    select id from public.audit_events
    where org_id = (select org_id from _audit_fixture)
  $$,
  'admin can select audit_events via RLS'
);

reset role;
select pg_temp.as_user((select member_id from _audit_fixture));
set local role authenticated;

select is_empty(
  $$
    select id from public.audit_events
    where org_id = (select org_id from _audit_fixture)
  $$,
  'member cannot see audit_events via RLS'
);

select * from finish();
rollback;

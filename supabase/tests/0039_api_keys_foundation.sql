begin;

select plan(20);

select ok(
  exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'api_keys'
  ),
  'api_keys table exists'
);

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.api_keys'::regclass
  ),
  'api_keys has RLS enabled'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_org_api_key(uuid, text, text, timestamptz)',
    'execute'
  ),
  'authenticated can execute create_org_api_key'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.list_org_api_keys(uuid)',
    'execute'
  ),
  'authenticated can execute list_org_api_keys'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.revoke_org_api_key(uuid, uuid)',
    'execute'
  ),
  'authenticated can execute revoke_org_api_key'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.resolve_api_key_by_hash(text)',
    'execute'
  ),
  'authenticated cannot execute resolve_api_key_by_hash'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.resolve_api_key_by_hash(text)',
    'execute'
  ),
  'service_role can execute resolve_api_key_by_hash'
);

select ok(
  not exists (
    select 1
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'api_keys'
      and grantee = 'authenticated'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ),
  'authenticated cannot mutate api_keys directly'
);

create temporary table _api_keys_fixture (
  owner_id uuid,
  admin_id uuid,
  member_id uuid,
  org_id uuid,
  key_id uuid,
  secret text,
  key_hash text
) on commit drop;

grant all on table _api_keys_fixture to authenticated;

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
    extensions.crypt('api-keys-foundation-password', extensions.gen_salt('bf')),
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
  owner_id := pg_temp.make_auth_user('apikey-owner@example.test', 'API Key Owner');
  admin_id := pg_temp.make_auth_user('apikey-admin@example.test', 'API Key Admin');
  member_id := pg_temp.make_auth_user('apikey-member@example.test', 'API Key Member');

  perform pg_temp.as_user(owner_id);
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'API Keys Org',
    'api-keys-org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id into org_id;

  insert into public.memberships (org_id, user_id, role, status)
  values
    (org_id, owner_id, 'owner', 'active'),
    (org_id, admin_id, 'admin', 'active'),
    (org_id, member_id, 'member', 'active');

  insert into _api_keys_fixture (owner_id, admin_id, member_id, org_id)
  values (owner_id, admin_id, member_id, org_id);
end;
$$;

set local role authenticated;
select pg_temp.as_user((select owner_id from _api_keys_fixture));

select lives_ok(
  $$
    with created as (
      select public.create_org_api_key(
        (select org_id from _api_keys_fixture),
        'Staging agent',
        'member',
        null
      ) as payload
    )
    update _api_keys_fixture f
    set
      key_id = (created.payload ->> 'id')::uuid,
      secret = created.payload ->> 'secret',
      key_hash = encode(extensions.digest(created.payload ->> 'secret', 'sha256'), 'hex')
    from created
  $$,
  'owner can create an API key'
);

select ok(
  (
    select secret ~ '^crm_key_[0-9a-f]{32}$'
    from _api_keys_fixture
  ),
  'created secret matches crm_key_ + 32 hex chars'
);

reset role;
select pg_temp.as_user((select admin_id from _api_keys_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.create_org_api_key(
      (select org_id from _api_keys_fixture),
      'Owner scope',
      'owner',
      null
    )
  $$,
  '42501',
  'API key role cannot exceed creator role',
  'admin cannot mint owner role key'
);

reset role;
select pg_temp.as_user((select member_id from _api_keys_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.create_org_api_key(
      (select org_id from _api_keys_fixture),
      'Member key',
      'member',
      null
    )
  $$,
  '42501',
  'Forbidden',
  'member cannot create API keys'
);

reset role;
select pg_temp.as_user((select owner_id from _api_keys_fixture));
set local role authenticated;

select is(
  (
    select jsonb_array_length(public.list_org_api_keys((select org_id from _api_keys_fixture)))
  ),
  1,
  'list returns the active key'
);

-- resolve is service_role-only for grants; exercise via superuser after reset.
reset role;

select ok(
  (
    select public.resolve_api_key_by_hash((select key_hash from _api_keys_fixture))
      ->> 'id'
    =
    (select key_id::text from _api_keys_fixture)
  ),
  'resolve_api_key_by_hash returns the key'
);

select ok(
  (
    select public.resolve_api_key_by_hash((select key_hash from _api_keys_fixture))
      ->> 'org_id'
    =
    (select org_id::text from _api_keys_fixture)
  ),
  'resolved key is pinned to org'
);

select ok(
  (
    select public.resolve_api_key_by_hash((select key_hash from _api_keys_fixture))
      ->> 'creator_membership_id'
    =
    (
      select memberships.id::text
      from public.memberships
      where memberships.org_id = (select org_id from _api_keys_fixture)
        and memberships.user_id = (select owner_id from _api_keys_fixture)
        and memberships.status = 'active'
    )
  ),
  'resolve_api_key_by_hash returns creator_membership_id'
);

select ok(
  has_table_privilege('service_role', 'public.memberships', 'select'),
  'service_role can select memberships via Data API grants'
);

set local role authenticated;
select pg_temp.as_user((select owner_id from _api_keys_fixture));

select lives_ok(
  $$
    select public.revoke_org_api_key(
      (select org_id from _api_keys_fixture),
      (select key_id from _api_keys_fixture)
    )
  $$,
  'owner can revoke API key'
);

reset role;

select ok(
  public.resolve_api_key_by_hash((select key_hash from _api_keys_fixture)) is null,
  'revoked key no longer resolves'
);

select is(
  (
    select count(*)::integer
    from public.audit_events
    where org_id = (select org_id from _api_keys_fixture)
      and action in ('api_key.created', 'api_key.revoked')
  ),
  2,
  'create and revoke write audit events'
);

select * from finish();
rollback;

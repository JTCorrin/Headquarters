begin;

select plan(12);

select ok(
  has_function_privilege(
    'authenticated',
    'public.soft_delete_lead(uuid, uuid, integer)',
    'execute'
  ),
  'authenticated users can execute soft_delete_lead'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.soft_delete_lead(uuid, uuid, integer)',
    'execute'
  ),
  'anonymous users cannot execute soft_delete_lead'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.soft_delete_client(uuid, uuid, integer)',
    'execute'
  ),
  'authenticated users can execute soft_delete_client'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.soft_delete_client(uuid, uuid, integer)',
    'execute'
  ),
  'anonymous users cannot execute soft_delete_client'
);

create temporary table _lc_del_fixture (
  owner_id uuid,
  outsider_id uuid,
  org_id uuid,
  lead_id uuid,
  lead_version integer,
  client_id uuid,
  client_version integer
) on commit drop;

grant all on table _lc_del_fixture to authenticated;

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
    extensions.crypt('lc-del-password', extensions.gen_salt('bf')),
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

insert into _lc_del_fixture (owner_id, outsider_id)
values (
  pg_temp.make_auth_user('lc-del-owner@example.test', 'LC Del Owner'),
  pg_temp.make_auth_user('lc-del-outsider@example.test', 'LC Del Outsider')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'LC Del Org',
    'lc-del-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
)
update _lc_del_fixture
set org_id = created_org.id
from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active'
from _lc_del_fixture;

with created_lead as (
  insert into public.leads (
    org_id,
    name,
    stage,
    currency,
    created_by,
    updated_by
  )
  select
    org_id,
    'Deletable Lead',
    'qualified',
    'GBP',
    owner_id,
    owner_id
  from _lc_del_fixture
  returning id, version
)
update _lc_del_fixture
set
  lead_id = created_lead.id,
  lead_version = created_lead.version
from created_lead;

with created_client as (
  insert into public.clients (
    org_id,
    name,
    status,
    created_by,
    updated_by
  )
  select
    org_id,
    'Deletable Client',
    'prospect',
    owner_id,
    owner_id
  from _lc_del_fixture
  returning id, version
)
update _lc_del_fixture
set
  client_id = created_client.id,
  client_version = created_client.version
from created_client;

select pg_temp.as_user((select owner_id from _lc_del_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.soft_delete_lead(
      (select lead_id from _lc_del_fixture),
      (select org_id from _lc_del_fixture),
      (select lead_version from _lc_del_fixture)
    )
  $$,
  'owner can soft-delete a lead via RPC'
);

select is(
  (
    select count(*)::integer
    from public.leads
    where id = (select lead_id from _lc_del_fixture)
  ),
  0,
  'soft-deleted leads are hidden by RLS'
);

select throws_ok(
  $$
    select public.soft_delete_lead(
      (select lead_id from _lc_del_fixture),
      (select org_id from _lc_del_fixture),
      (select lead_version from _lc_del_fixture)
    )
  $$,
  'P0002',
  null,
  'soft_delete_lead returns not-found after delete'
);

select lives_ok(
  $$
    select public.soft_delete_client(
      (select client_id from _lc_del_fixture),
      (select org_id from _lc_del_fixture),
      (select client_version from _lc_del_fixture)
    )
  $$,
  'owner can soft-delete a client via RPC'
);

select is(
  (
    select count(*)::integer
    from public.clients
    where id = (select client_id from _lc_del_fixture)
  ),
  0,
  'soft-deleted clients are hidden by RLS'
);

select throws_ok(
  $$
    select public.soft_delete_client(
      (select client_id from _lc_del_fixture),
      (select org_id from _lc_del_fixture),
      (select client_version from _lc_del_fixture)
    )
  $$,
  'P0002',
  null,
  'soft_delete_client returns not-found after delete'
);

reset role;
with recreated as (
  insert into public.leads (
    org_id,
    name,
    stage,
    currency,
    created_by,
    updated_by
  )
  select
    org_id,
    'Outsider Lead Target',
    'new',
    'GBP',
    owner_id,
    owner_id
  from _lc_del_fixture
  returning id, version
)
update _lc_del_fixture
set
  lead_id = recreated.id,
  lead_version = recreated.version
from recreated;

with recreated_client as (
  insert into public.clients (
    org_id,
    name,
    status,
    created_by,
    updated_by
  )
  select
    org_id,
    'Outsider Client Target',
    'prospect',
    owner_id,
    owner_id
  from _lc_del_fixture
  returning id, version
)
update _lc_del_fixture
set
  client_id = recreated_client.id,
  client_version = recreated_client.version
from recreated_client;

select pg_temp.as_user((select outsider_id from _lc_del_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.soft_delete_lead(
      (select lead_id from _lc_del_fixture),
      (select org_id from _lc_del_fixture),
      (select lead_version from _lc_del_fixture)
    )
  $$,
  '42501',
  null,
  'outsiders cannot soft-delete another organisation lead'
);

select throws_ok(
  $$
    select public.soft_delete_client(
      (select client_id from _lc_del_fixture),
      (select org_id from _lc_del_fixture),
      (select client_version from _lc_del_fixture)
    )
  $$,
  '42501',
  null,
  'outsiders cannot soft-delete another organisation client'
);

reset role;

select * from finish();

rollback;

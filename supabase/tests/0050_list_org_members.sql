begin;

select plan(8);

select ok(
  has_function_privilege(
    'authenticated',
    'public.list_org_members(uuid)',
    'execute'
  ),
  'authenticated can execute list_org_members'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.list_org_members(uuid)',
    'execute'
  ),
  'anon cannot execute list_org_members'
);

create temporary table _org_members_fixture (
  owner_id uuid,
  member_id uuid,
  billing_id uuid,
  org_id uuid,
  owner_membership_id uuid,
  member_membership_id uuid
) on commit drop;

grant all on table _org_members_fixture to authenticated;

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
    extensions.crypt('org-members-password', extensions.gen_salt('bf')),
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

insert into _org_members_fixture (owner_id, member_id, billing_id)
values (
  pg_temp.make_auth_user('org-members-owner@example.test', 'Org Members Owner'),
  pg_temp.make_auth_user('org-members-member@example.test', 'Org Members Member'),
  pg_temp.make_auth_user('org-members-billing@example.test', 'Org Members Billing')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Org Members Org',
    'org-members-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
)
update _org_members_fixture
set org_id = created_org.id
from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _org_members_fixture;

insert into public.memberships (org_id, user_id, role, status)
select org_id, member_id, 'member', 'active' from _org_members_fixture;

insert into public.memberships (org_id, user_id, role, status)
select org_id, billing_id, 'billing', 'active' from _org_members_fixture;

update _org_members_fixture
set
  owner_membership_id = (
    select m.id from public.memberships m
    where m.org_id = _org_members_fixture.org_id
      and m.user_id = _org_members_fixture.owner_id
  ),
  member_membership_id = (
    select m.id from public.memberships m
    where m.org_id = _org_members_fixture.org_id
      and m.user_id = _org_members_fixture.member_id
  );

select pg_temp.as_user((select owner_id from _org_members_fixture));
set local role authenticated;

select is(
  (
    select jsonb_array_length(public.list_org_members((select org_id from _org_members_fixture)))
  ),
  2,
  'list_org_members returns owner and member, excludes billing'
);

select ok(
  (
    select bool_and(elem ? 'membership_id' and elem ? 'display_name' and elem ? 'role')
    from jsonb_array_elements(
      public.list_org_members((select org_id from _org_members_fixture))
    ) as elem
  ),
  'list_org_members rows include membership_id, display_name, role'
);

select ok(
  (
    select count(*) = 1
    from jsonb_array_elements(
      public.list_org_members((select org_id from _org_members_fixture))
    ) as elem
    where elem ->> 'membership_id' = (
      select owner_membership_id::text from _org_members_fixture
    )
      and elem ->> 'display_name' = 'Org Members Owner'
      and elem ->> 'role' = 'owner'
  ),
  'list_org_members includes owner display_name'
);

select pg_temp.as_user((select billing_id from _org_members_fixture));

select throws_ok(
  $$
    select public.list_org_members((select org_id from _org_members_fixture))
  $$,
  '42501',
  null,
  'billing role cannot list org members'
);

reset role;
select pg_temp.as_user((select owner_id from _org_members_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.list_org_members('00000000-0000-4000-8000-000000000099'::uuid)
  $$,
  '42501',
  null,
  'list_org_members forbids foreign org'
);

select * from finish();
rollback;

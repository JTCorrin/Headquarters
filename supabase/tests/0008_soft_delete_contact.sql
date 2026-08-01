begin;

select plan(6);

select ok(
  has_function_privilege(
    'authenticated',
    'public.soft_delete_contact(uuid, uuid, integer)',
    'execute'
  ),
  'authenticated users can execute soft_delete_contact'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.soft_delete_contact(uuid, uuid, integer)',
    'execute'
  ),
  'anonymous users cannot execute soft_delete_contact'
);

create temporary table _contact_del_fixture (
  owner_id uuid,
  outsider_id uuid,
  org_id uuid,
  contact_id uuid,
  contact_version integer
) on commit drop;

grant all on table _contact_del_fixture to authenticated;

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
    extensions.crypt('contact-del-password', extensions.gen_salt('bf')),
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

insert into _contact_del_fixture (owner_id, outsider_id)
values (
  pg_temp.make_auth_user('contact-del-owner@example.test', 'Contact Del Owner'),
  pg_temp.make_auth_user('contact-del-outsider@example.test', 'Contact Del Outsider')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Contact Del Org',
    'contact-del-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
)
update _contact_del_fixture
set org_id = created_org.id
from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active'
from _contact_del_fixture;

with created_contact as (
  insert into public.contacts (
    org_id,
    display_name,
    created_by,
    updated_by
  )
  select
    org_id,
    'Deletable Contact',
    owner_id,
    owner_id
  from _contact_del_fixture
  returning id, version
)
update _contact_del_fixture
set
  contact_id = created_contact.id,
  contact_version = created_contact.version
from created_contact;

select pg_temp.as_user((select owner_id from _contact_del_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.soft_delete_contact(
      (select contact_id from _contact_del_fixture),
      (select org_id from _contact_del_fixture),
      (select contact_version from _contact_del_fixture)
    )
  $$,
  'owner can soft-delete a contact via RPC'
);

select is(
  (
    select count(*)::integer
    from public.contacts
    where id = (select contact_id from _contact_del_fixture)
  ),
  0,
  'soft-deleted contacts are hidden by RLS'
);

select throws_ok(
  $$
    select public.soft_delete_contact(
      (select contact_id from _contact_del_fixture),
      (select org_id from _contact_del_fixture),
      (select contact_version from _contact_del_fixture)
    )
  $$,
  'P0002',
  null,
  'soft_delete_contact returns not-found after delete'
);

reset role;
select pg_temp.as_user((select outsider_id from _contact_del_fixture));
set local role authenticated;

-- Recreate a live contact as table owner for the outsider denial check.
reset role;
with recreated as (
  insert into public.contacts (
    org_id,
    display_name,
    created_by,
    updated_by
  )
  select
    org_id,
    'Outsider Target',
    owner_id,
    owner_id
  from _contact_del_fixture
  returning id, version
)
update _contact_del_fixture
set
  contact_id = recreated.id,
  contact_version = recreated.version
from recreated;

select pg_temp.as_user((select outsider_id from _contact_del_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.soft_delete_contact(
      (select contact_id from _contact_del_fixture),
      (select org_id from _contact_del_fixture),
      (select contact_version from _contact_del_fixture)
    )
  $$,
  '42501',
  null,
  'outsiders cannot soft-delete another organisation contact'
);

reset role;

select * from finish();

rollback;

begin;

select plan(7);

select ok(
  has_function_privilege(
    'service_role',
    'public.create_contact_with_primary_client(uuid, jsonb, uuid, boolean, uuid)',
    'execute'
  ),
  'service_role can execute create_contact_with_primary_client'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.update_contact_with_primary_client(uuid, uuid, integer, jsonb, uuid, boolean, uuid)',
    'execute'
  ),
  'service_role can execute update_contact_with_primary_client'
);

create temporary table _contact_actor_fixture (
  owner_id uuid,
  outsider_id uuid,
  org_id uuid,
  contact_id uuid,
  contact_version integer
) on commit drop;

grant all on table _contact_actor_fixture to authenticated;
grant all on table _contact_actor_fixture to service_role;

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
    extensions.crypt('contact-actor-password', extensions.gen_salt('bf')),
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
  outsider_id uuid;
  org_id uuid;
begin
  owner_id := pg_temp.make_auth_user('contact-actor-owner@example.test', 'Contact Actor Owner');
  outsider_id := pg_temp.make_auth_user(
    'contact-actor-outsider@example.test',
    'Contact Actor Outsider'
  );

  perform pg_temp.as_user(owner_id);
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Contact Actor Org',
    'contact-actor-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id into org_id;

  insert into public.memberships (org_id, user_id, role, status)
  values (org_id, owner_id, 'owner', 'active');

  insert into _contact_actor_fixture (owner_id, outsider_id, org_id)
  values (owner_id, outsider_id, org_id);
end;
$$;

-- JWT path still works without p_actor_id
select pg_temp.as_user((select owner_id from _contact_actor_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.create_contact_with_primary_client(
      (select org_id from _contact_actor_fixture),
      jsonb_build_object('display_name', 'JWT Contact'),
      null,
      false
    )
  $$,
  'JWT create_contact_with_primary_client still works without p_actor_id'
);

-- service_role path is claim-gated (not SET ROLE)
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config(
  'request.jwt.claims',
  json_build_object('role', 'service_role')::text,
  true
);

select throws_ok(
  $$
    select public.create_contact_with_primary_client(
      (select org_id from _contact_actor_fixture),
      jsonb_build_object('display_name', 'No Actor Contact'),
      null,
      false,
      null
    )
  $$,
  '42501',
  'Authentication is required',
  'service_role create without p_actor_id is rejected'
);

select throws_ok(
  $$
    select public.create_contact_with_primary_client(
      (select org_id from _contact_actor_fixture),
      jsonb_build_object('display_name', 'Outsider Contact'),
      null,
      false,
      (select outsider_id from _contact_actor_fixture)
    )
  $$,
  '42501',
  'This action is not permitted',
  'service_role create with non-member p_actor_id is rejected'
);

select is(
  (
    select (public.create_contact_with_primary_client(
      (select org_id from _contact_actor_fixture),
      jsonb_build_object('display_name', 'API Key Contact'),
      null,
      false,
      (select owner_id from _contact_actor_fixture)
    ) -> 'contact' ->> 'created_by')
  ),
  (select owner_id::text from _contact_actor_fixture),
  'service_role create stores created_by from p_actor_id'
);

update _contact_actor_fixture
set
  contact_id = contacts.id,
  contact_version = contacts.version
from public.contacts
where contacts.org_id = _contact_actor_fixture.org_id
  and contacts.display_name = 'API Key Contact'
  and contacts.deleted_at is null;

select is(
  (
    select (public.update_contact_with_primary_client(
      (select contact_id from _contact_actor_fixture),
      (select org_id from _contact_actor_fixture),
      (select contact_version from _contact_actor_fixture),
      jsonb_build_object('notes', 'updated via service_role'),
      null,
      false,
      (select owner_id from _contact_actor_fixture)
    ) -> 'contact' ->> 'notes')
  ),
  'updated via service_role',
  'service_role update_contact_with_primary_client works with p_actor_id'
);

select * from finish();
rollback;

begin;

select plan(18);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_contact_with_primary_client(uuid, jsonb, uuid, boolean)',
    'execute'
  ),
  'authenticated users can execute create_contact_with_primary_client'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.update_contact_with_primary_client(uuid, uuid, integer, jsonb, uuid, boolean)',
    'execute'
  ),
  'authenticated users can execute update_contact_with_primary_client'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.create_contact_with_primary_client(uuid, jsonb, uuid, boolean)',
    'execute'
  ),
  'anonymous users cannot execute create_contact_with_primary_client'
);

create temporary table _primary_link_fixture (
  owner_id uuid,
  outsider_id uuid,
  org_id uuid,
  other_org_id uuid,
  client_a uuid,
  client_b uuid,
  foreign_client uuid,
  contact_id uuid,
  contact_version integer,
  displaced_contact_id uuid,
  displaced_version integer,
  secondary_link_id uuid
) on commit drop;

grant all on table _primary_link_fixture to authenticated;

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
    extensions.crypt('primary-link-password', extensions.gen_salt('bf')),
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

insert into _primary_link_fixture (owner_id, outsider_id)
values (
  pg_temp.make_auth_user('primary-link-owner@example.test', 'Primary Link Owner'),
  pg_temp.make_auth_user('primary-link-outsider@example.test', 'Primary Link Outsider')
);

with created_org as (
  insert into public.organisations (name, slug, country_code)
  values (
    'Primary Link Org',
    'primary-link-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB'
  )
  returning id
),
other_org as (
  insert into public.organisations (name, slug, country_code)
  values (
    'Primary Link Other Org',
    'primary-other-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB'
  )
  returning id
)
update _primary_link_fixture
set
  org_id = created_org.id,
  other_org_id = other_org.id
from created_org, other_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _primary_link_fixture;

insert into public.memberships (org_id, user_id, role, status)
select other_org_id, outsider_id, 'owner', 'active' from _primary_link_fixture;

with clients as (
  insert into public.clients (org_id, name, status, created_by, updated_by)
  select org_id, 'Client A', 'active', owner_id, owner_id from _primary_link_fixture
  returning id
)
update _primary_link_fixture set client_a = clients.id from clients;

with clients as (
  insert into public.clients (org_id, name, status, created_by, updated_by)
  select org_id, 'Client B', 'active', owner_id, owner_id from _primary_link_fixture
  returning id
)
update _primary_link_fixture set client_b = clients.id from clients;

with clients as (
  insert into public.clients (org_id, name, status, created_by, updated_by)
  select other_org_id, 'Foreign Client', 'active', outsider_id, outsider_id
  from _primary_link_fixture
  returning id
)
update _primary_link_fixture set foreign_client = clients.id from clients;

-- Cross-org create rolls back: no orphan contact
select pg_temp.as_user((select owner_id from _primary_link_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.create_contact_with_primary_client(
      (select org_id from _primary_link_fixture),
      jsonb_build_object('display_name', 'Should Not Persist'),
      (select foreign_client from _primary_link_fixture),
      true
    )
  $$,
  '22023',
  null,
  'create with cross-org client_id is denied'
);

reset role;

select ok(
  not exists (
    select 1
    from public.contacts
    where org_id = (select org_id from _primary_link_fixture)
      and display_name = 'Should Not Persist'
  ),
  'failed create with bad client_id does not leave an orphan contact'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'client_contacts_one_primary_per_contact_uidx'
  ),
  'partial unique index enforces one active primary client per contact'
);

-- Seed a contact already primary on client A so create can displace them.
with displaced as (
  insert into public.contacts (
    org_id, display_name, primary_email, created_by, updated_by
  )
  select
    org_id,
    'Displaced Contact',
    'displaced@example.test',
    owner_id,
    owner_id
  from _primary_link_fixture
  returning id, version
)
update _primary_link_fixture
set
  displaced_contact_id = displaced.id,
  displaced_version = displaced.version
from displaced;

insert into public.client_contacts (
  org_id, client_id, contact_id, role, is_primary, created_by, updated_by
)
select org_id, client_a, displaced_contact_id, 'primary', true, owner_id, owner_id
from _primary_link_fixture;

-- Happy create + primary link (displaces the seeded primary)
select pg_temp.as_user((select owner_id from _primary_link_fixture));
set local role authenticated;

update _primary_link_fixture
set
  contact_id = (
    select (public.create_contact_with_primary_client(
      org_id,
      jsonb_build_object('display_name', 'Linked Contact', 'primary_email', 'link@example.test'),
      client_a,
      true
    ) -> 'contact' ->> 'id')::uuid
    from _primary_link_fixture
  );

update _primary_link_fixture
set contact_version = (
  select version from public.contacts where id = contact_id
);

reset role;

select ok(
  exists (
    select 1
    from public.client_contacts
    join _primary_link_fixture f
      on f.client_a = client_contacts.client_id
     and f.contact_id = client_contacts.contact_id
    where client_contacts.is_primary
      and client_contacts.deleted_at is null
  ),
  'create_contact_with_primary_client writes the primary client_contacts link'
);

select ok(
  (
    select version > f.displaced_version
    from public.contacts
    join _primary_link_fixture f on f.displaced_contact_id = contacts.id
  ),
  'displacing a client primary bumps the displaced contact version'
);

select pg_temp.as_user((select owner_id from _primary_link_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.update_contact_with_primary_client(
      (select displaced_contact_id from _primary_link_fixture),
      (select org_id from _primary_link_fixture),
      (select displaced_version from _primary_link_fixture),
      jsonb_build_object('display_name', 'Stale Displaced'),
      null,
      false
    )
  $$,
  'P0001',
  null,
  'displaced contact rejects stale If-Match after primary takeover'
);

reset role;

-- Refresh displaced version after the bump for later assertions
update _primary_link_fixture
set displaced_version = (
  select version from public.contacts where id = displaced_contact_id
);

-- Direct insert cannot create a second active primary for the same contact
select throws_ok(
  $$
    insert into public.client_contacts (
      org_id, client_id, contact_id, role, is_primary, created_by, updated_by
    )
    select org_id, client_b, contact_id, 'primary', true, owner_id, owner_id
    from _primary_link_fixture
  $$,
  '23505',
  null,
  'unique index rejects a second active primary client for one contact'
);

-- Seed an unrelated secondary link to client B (simulates prior M2M membership)
with secondary as (
  insert into public.client_contacts (
    org_id, client_id, contact_id, role, is_primary, created_by, updated_by
  )
  select org_id, client_b, contact_id, 'billing', false, owner_id, owner_id
  from _primary_link_fixture
  returning id
)
update _primary_link_fixture
set secondary_link_id = secondary.id
from secondary;

-- Primary reassignment A → B preserves secondary-shaped link history on A as non-primary
-- and keeps the existing B row (promoted), without deleting either.
select pg_temp.as_user((select owner_id from _primary_link_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.update_contact_with_primary_client(
      (select contact_id from _primary_link_fixture),
      (select org_id from _primary_link_fixture),
      (select contact_version from _primary_link_fixture),
      '{}'::jsonb,
      (select client_b from _primary_link_fixture),
      true
    )
  $$,
  'update can reassign primary client_id with link-only payload'
);

reset role;

update _primary_link_fixture
set contact_version = (
  select version from public.contacts where id = contact_id
);

select ok(
  exists (
    select 1
    from public.client_contacts
    join _primary_link_fixture f
      on f.client_a = client_contacts.client_id
     and f.contact_id = client_contacts.contact_id
    where client_contacts.deleted_at is null
      and client_contacts.is_primary = false
      and client_contacts.role <> 'primary'
  )
  and exists (
    select 1
    from public.client_contacts
    join _primary_link_fixture f
      on f.client_b = client_contacts.client_id
     and f.contact_id = client_contacts.contact_id
    where client_contacts.deleted_at is null
      and client_contacts.is_primary
      and client_contacts.role = 'primary'
  )
  and exists (
    select 1
    from public.client_contacts
    where id = (select secondary_link_id from _primary_link_fixture)
      and deleted_at is null
  ),
  'primary reassignment demotes prior primary and preserves secondary client_contacts'
);

select ok(
  (
    select role = 'other'
      and is_primary = false
    from public.client_contacts
    join _primary_link_fixture f
      on f.client_a = client_contacts.client_id
     and f.contact_id = client_contacts.contact_id
    where client_contacts.deleted_at is null
  ),
  'demoted primary clears is_primary and role=primary together (role becomes other)'
);

select ok(
  (
    select version = (select contact_version from _primary_link_fixture)
      and version > 1
    from public.contacts
    where id = (select contact_id from _primary_link_fixture)
  ),
  'link-only update advances contact version for If-Match serialization'
);

-- Stale version rejected; primary link unchanged
select pg_temp.as_user((select owner_id from _primary_link_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.update_contact_with_primary_client(
      (select contact_id from _primary_link_fixture),
      (select org_id from _primary_link_fixture),
      1,
      '{}'::jsonb,
      (select client_a from _primary_link_fixture),
      true
    )
  $$,
  'P0001',
  null,
  'stale expected_version rejects primary-link update'
);

reset role;

select ok(
  (
    select client_contacts.client_id = f.client_b
      and client_contacts.is_primary
    from public.client_contacts
    join _primary_link_fixture f on f.contact_id = client_contacts.contact_id
    where client_contacts.is_primary
      and client_contacts.deleted_at is null
  ),
  'stale-version rejection leaves the primary client link unchanged'
);

-- Cross-org update rolls back contact field changes
select pg_temp.as_user((select owner_id from _primary_link_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.update_contact_with_primary_client(
      (select contact_id from _primary_link_fixture),
      (select org_id from _primary_link_fixture),
      (select contact_version from _primary_link_fixture),
      jsonb_build_object('display_name', 'Hijacked Name'),
      (select foreign_client from _primary_link_fixture),
      true
    )
  $$,
  '22023',
  null,
  'update with cross-org client_id is denied'
);

reset role;

select ok(
  (
    select display_name = 'Linked Contact'
    from public.contacts
    where id = (select contact_id from _primary_link_fixture)
  ),
  'failed update with bad client_id rolls back contact field changes'
);

select * from finish();

rollback;

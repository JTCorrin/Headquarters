begin;

select plan(28);

select has_table(
  'public',
  'organisation_invitations',
  'organisation invitations table exists'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.organisation_invitations'::regclass),
  'organisation invitations have RLS enabled'
);
select ok(
  not has_function_privilege('anon', 'public.accept_organisation_invitation(text)', 'execute'),
  'anonymous users cannot accept invitations'
);
select ok(
  has_function_privilege('authenticated', 'public.accept_organisation_invitation(text)', 'execute'),
  'authenticated users can accept invitations'
);
select ok(
  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'organisation_invitations'
      and grantee = 'authenticated'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ),
  'authenticated users cannot mutate invitation rows directly'
);

create temporary table _access_fixture (
  owner_id uuid,
  admin_id uuid,
  member_id uuid,
  invitee_id uuid,
  wrong_user_id uuid,
  org_id uuid,
  owner_membership_id uuid,
  admin_membership_id uuid,
  member_membership_id uuid,
  invitation_id uuid
) on commit drop;

grant all on table _access_fixture to authenticated;

create or replace function pg_temp.make_auth_user(
  p_email text,
  p_name text,
  p_verified boolean default true
)
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
    extensions.crypt('access-password', extensions.gen_salt('bf')),
    case when p_verified then now() else null end,
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

insert into _access_fixture (owner_id, admin_id, member_id, invitee_id, wrong_user_id)
values (
  pg_temp.make_auth_user('access-owner@example.test', 'Access Owner'),
  pg_temp.make_auth_user('access-admin@example.test', 'Access Admin'),
  pg_temp.make_auth_user('access-member@example.test', 'Access Member'),
  pg_temp.make_auth_user('invited@example.test', 'Invited User'),
  pg_temp.make_auth_user('wrong@example.test', 'Wrong User')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Access Test Org',
    'access-test-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
)
update _access_fixture set org_id = created_org.id from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _access_fixture
union all
select org_id, admin_id, 'admin', 'active' from _access_fixture
union all
select org_id, member_id, 'member', 'active' from _access_fixture;

update _access_fixture
set
  owner_membership_id = (
    select id from public.memberships
    where org_id = _access_fixture.org_id and user_id = _access_fixture.owner_id
  ),
  admin_membership_id = (
    select id from public.memberships
    where org_id = _access_fixture.org_id and user_id = _access_fixture.admin_id
  ),
  member_membership_id = (
    select id from public.memberships
    where org_id = _access_fixture.org_id and user_id = _access_fixture.member_id
  );

set local role authenticated;
select pg_temp.as_user((select owner_id from _access_fixture));

select throws_ok(
  $$select public.create_organisation_invitation(
    (select org_id from _access_fixture),
    'owner-invite@example.test',
    'owner',
    repeat('a', 64),
    now() + interval '7 days'
  )$$,
  '22023',
  'Invalid invitation role',
  'owner invitations are rejected'
);

select lives_ok(
  $$select public.create_organisation_invitation(
    (select org_id from _access_fixture),
    '  INVITED@EXAMPLE.TEST ',
    'member',
    repeat('b', 64),
    now() + interval '7 days'
  )$$,
  'owners can create non-owner invitations'
);

reset role;
update _access_fixture
set invitation_id = (
  select id from public.organisation_invitations
  where org_id = _access_fixture.org_id and email = 'invited@example.test'
);

select is(
  (select email::text from public.organisation_invitations where id = (
    select invitation_id from _access_fixture
  )),
  'invited@example.test',
  'invitation email is normalized'
);
select ok(
  (select token_hash = repeat('b', 64) from public.organisation_invitations where id = (
    select invitation_id from _access_fixture
  )),
  'only the token hash is stored'
);

set local role authenticated;
select pg_temp.as_user((select member_id from _access_fixture));
select throws_ok(
  $$select public.list_organisation_invitations((select org_id from _access_fixture))$$,
  '42501',
  'Forbidden',
  'ordinary members cannot list invitations'
);

select pg_temp.as_user((select admin_id from _access_fixture));
select lives_ok(
  $$select public.list_organisation_invitations((select org_id from _access_fixture))$$,
  'admins can list invitations'
);
select ok(
  public.list_organisation_members((select org_id from _access_fixture))
    @> '[{"email":"access-owner@example.test"}]'::jsonb,
  'member management directory includes authentication emails for administrators'
);
select throws_ok(
  $$select public.create_organisation_invitation(
    (select org_id from _access_fixture),
    'another-admin@example.test',
    'admin',
    repeat('d', 64),
    now() + interval '7 days'
  )$$,
  '42501',
  'Only owners can invite administrators',
  'admins cannot invite peer administrators'
);
select throws_ok(
  $$select public.update_organisation_member(
    (select org_id from _access_fixture),
    (select admin_membership_id from _access_fixture),
    'member',
    null
  )$$,
  '42501',
  'Admins cannot manage other admins',
  'admins cannot demote admins'
);
select throws_ok(
  $$select public.update_organisation_member(
    (select org_id from _access_fixture),
    (select member_membership_id from _access_fixture),
    'admin',
    null
  )$$,
  '42501',
  'Only owners can promote admins',
  'admins cannot promote admins'
);

reset role;
insert into public.organisation_invitations (
  org_id, email, role, token_hash, invited_by, expires_at, revoked_at, revoked_by
)
select
  org_id, 'wrong-user@example.test', 'member', repeat('c', 64), owner_id,
  now() + interval '7 days', now(), owner_id
from _access_fixture;
insert into public.organisation_invitations (
  org_id, email, role, token_hash, invited_by, created_at, expires_at
)
select
  org_id, 'wrong-user@example.test', 'member', repeat('e', 64), owner_id,
  now() - interval '2 days', now() - interval '1 day'
from _access_fixture;

select pg_temp.as_user((select wrong_user_id from _access_fixture));
select throws_ok(
  $$select public.accept_organisation_invitation(repeat('c', 64))$$,
  'P0002',
  'Invitation is invalid or expired',
  'revoked invitation tokens cannot be accepted'
);
select throws_ok(
  $$select public.accept_organisation_invitation(repeat('e', 64))$$,
  'P0002',
  'Invitation is invalid or expired',
  'expired invitation tokens cannot be accepted'
);
select throws_ok(
  $$select public.accept_organisation_invitation(repeat('b', 64))$$,
  '42501',
  'Invitation email does not match the verified authentication email',
  'acceptance requires the exact verified auth email'
);

select pg_temp.as_user((select invitee_id from _access_fixture));
select lives_ok(
  $$select public.accept_organisation_invitation(repeat('b', 64))$$,
  'matching verified user can accept once'
);
select throws_ok(
  $$select public.accept_organisation_invitation(repeat('b', 64))$$,
  'P0002',
  'Invitation is invalid or expired',
  'accepted token cannot be reused'
);

select ok(
  exists (
    select 1 from public.memberships
    where org_id = (select org_id from _access_fixture)
      and user_id = (select invitee_id from _access_fixture)
      and role = 'member'
      and status = 'active'
  ),
  'acceptance creates the requested active membership'
);

select pg_temp.as_user((select owner_id from _access_fixture));
select throws_ok(
  $$select public.update_organisation_member(
    (select org_id from _access_fixture),
    (select owner_membership_id from _access_fixture),
    'member',
    null
  )$$,
  '42501',
  'Use ownership transfer to change the owner',
  'owner cannot be demoted outside ownership transfer'
);
select lives_ok(
  $$select public.update_organisation_member(
    (select org_id from _access_fixture),
    (select member_membership_id from _access_fixture),
    'readonly',
    'suspended'
  )$$,
  'owner can change a non-owner role and status'
);
select lives_ok(
  $$select public.transfer_organisation_ownership(
    (select org_id from _access_fixture),
    (select admin_membership_id from _access_fixture)
  )$$,
  'active owner can transfer ownership atomically'
);
select is(
  (
    select count(*)::integer from public.memberships
    where org_id = (select org_id from _access_fixture)
      and role = 'owner'
      and status = 'active'
  ),
  1,
  'ownership transfer preserves one active owner'
);
select lives_ok(
  $$select public.remove_organisation_member(
    (select org_id from _access_fixture),
    (select member_membership_id from _access_fixture)
  )$$,
  'administrators can remove non-admin members'
);
select ok(
  not exists (
    select 1 from public.memberships
    where id = (select member_membership_id from _access_fixture)
  ),
  'removed memberships no longer grant organisation access'
);
select ok(
  (
    select count(*) >= 5 from public.audit_events
    where org_id = (select org_id from _access_fixture)
      and action in (
        'organisation.invitation_created',
        'organisation.invitation_accepted',
        'organisation.member_updated',
        'organisation.member_removed',
        'organisation.ownership_transferred'
      )
  ),
  'invitation and member mutations append audit events'
);

select * from finish();
rollback;

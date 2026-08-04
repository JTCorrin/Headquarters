begin;

select plan(7);

create temporary table _ai_acl_fixture (
  owner_id uuid,
  member_id uuid,
  org_id uuid,
  owner_membership_id uuid,
  member_membership_id uuid,
  mailbox_id uuid,
  message_id uuid,
  contact_id uuid,
  owner_suggestion_id uuid,
  member_suggestion_id uuid
);

grant all on table _ai_acl_fixture to authenticated;

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
    extensions.crypt('ai-acl-test-password', extensions.gen_salt('bf')),
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

insert into _ai_acl_fixture (owner_id, member_id)
values (
  pg_temp.make_auth_user('ai-acl-owner@example.test', 'AI ACL Owner'),
  pg_temp.make_auth_user('ai-acl-member@example.test', 'AI ACL Member')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'AI ACL Org',
    'ai-acl-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
)
update _ai_acl_fixture
set org_id = created_org.id
from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _ai_acl_fixture;
insert into public.memberships (org_id, user_id, role, status)
select org_id, member_id, 'member', 'active' from _ai_acl_fixture;

update _ai_acl_fixture
set
  owner_membership_id = (
    select m.id from public.memberships m
    where m.org_id = _ai_acl_fixture.org_id and m.user_id = _ai_acl_fixture.owner_id
  ),
  member_membership_id = (
    select m.id from public.memberships m
    where m.org_id = _ai_acl_fixture.org_id and m.user_id = _ai_acl_fixture.member_id
  );

with created_mailbox as (
  insert into public.mailbox_accounts (
    org_id, membership_id, email_address, from_name,
    imap_host, imap_port, imap_security,
    smtp_host, smtp_port, smtp_security,
    username, status, created_by, updated_by
  )
  select
    org_id, owner_membership_id, 'owner-acl@example.test', 'Owner',
    'imap.example.test', 993, 'tls',
    'smtp.example.test', 587, 'starttls',
    'owner-acl@example.test', 'active', owner_id, owner_id
  from _ai_acl_fixture
  returning id
)
update _ai_acl_fixture
set mailbox_id = created_mailbox.id
from created_mailbox;

with created_contact as (
  insert into public.contacts (org_id, display_name, primary_email, created_by, updated_by)
  select org_id, 'ACL Contact', 'peer-acl@example.test', owner_id, owner_id
  from _ai_acl_fixture
  returning id
)
update _ai_acl_fixture
set contact_id = created_contact.id
from created_contact;

with created_message as (
  insert into public.email_messages (
    org_id, mailbox_account_id, owner_membership_id,
    direction, status, from_address, to_addresses,
    subject, body_text, preview_text, received_at,
    created_by, updated_by
  )
  select
    org_id, mailbox_id, owner_membership_id,
    'inbound', 'received', 'peer-acl@example.test',
    jsonb_build_array('owner-acl@example.test'),
    'ACL check',
    'Private body for AI suggestion ACL.',
    'Private body for AI suggestion ACL.',
    now(),
    owner_id, owner_id
  from _ai_acl_fixture
  returning id
)
update _ai_acl_fixture
set message_id = created_message.id
from created_message;

insert into public.email_message_links (
  org_id, message_id, entity_type, entity_id, link_reason, created_by
)
select org_id, message_id, 'contact', contact_id, 'address_match', owner_id
from _ai_acl_fixture;

select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_suggestions'
      and policyname = 'ai_suggestions_select_creator_or_mailbox_owner'
  ),
  'ai_suggestions SELECT policy is creator-or-mailbox-owner'
);

select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_suggestions'
      and policyname = 'ai_suggestions_select_member'
  ),
  'org-wide ai_suggestions SELECT policy is removed'
);

select pg_temp.as_user((select owner_id from _ai_acl_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.create_email_reply_suggestion(
      (select org_id from _ai_acl_fixture),
      (select message_id from _ai_acl_fixture),
      '',
      'openrouter',
      'wave-b1-test',
      'neutral'
    )
  $$,
  'mailbox owner can create email reply suggestion'
);

update _ai_acl_fixture
set owner_suggestion_id = s.id
from public.ai_suggestions s
where s.org_id = _ai_acl_fixture.org_id
  and s.source_email_message_id = _ai_acl_fixture.message_id
  and s.created_by = _ai_acl_fixture.owner_id
  and s.deleted_at is null;

select pg_temp.as_user((select member_id from _ai_acl_fixture));
set local role authenticated;

select is(
  (
    select count(*)::integer
    from public.ai_suggestions
    where id = (select owner_suggestion_id from _ai_acl_fixture)
  ),
  0,
  'second member cannot SELECT owner suggestion without being creator'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);

insert into public.email_message_links (
  org_id, message_id, entity_type, entity_id, link_reason, created_by
)
select org_id, message_id, 'contact', contact_id, 'timeline_share', owner_id
from _ai_acl_fixture;

select pg_temp.as_user((select member_id from _ai_acl_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.create_email_reply_suggestion(
      (select org_id from _ai_acl_fixture),
      (select message_id from _ai_acl_fixture),
      '',
      'openrouter',
      'wave-b1-test',
      'warm'
    )
  $$,
  'shared member can create their own suggestion'
);

update _ai_acl_fixture
set member_suggestion_id = s.id
from public.ai_suggestions s
where s.org_id = _ai_acl_fixture.org_id
  and s.source_email_message_id = _ai_acl_fixture.message_id
  and s.created_by = _ai_acl_fixture.member_id
  and s.deleted_at is null;

select is(
  (
    select count(*)::integer
    from public.ai_suggestions
    where id in (
      select owner_suggestion_id from _ai_acl_fixture
      union all
      select member_suggestion_id from _ai_acl_fixture
    )
  ),
  1,
  'shared member sees only their own suggestion, not the owner suggestion'
);

reset role;
select pg_temp.as_user((select owner_id from _ai_acl_fixture));
set local role authenticated;

select is(
  (
    select count(*)::integer
    from public.ai_suggestions
    where id in (
      select owner_suggestion_id from _ai_acl_fixture
      union all
      select member_suggestion_id from _ai_acl_fixture
    )
  ),
  2,
  'mailbox owner can SELECT both own and member suggestions on owned mail'
);

select * from finish();
rollback;

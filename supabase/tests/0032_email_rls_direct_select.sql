-- P0: direct authenticated SELECT/INSERT on email RLS surface (C1–C3 regression guards).
-- RPC-only tests miss permission-denied / recursion / read-marker oracle failures.

begin;

select plan(12);

create temporary table _email_rls_fixture (
  owner_id uuid,
  member_id uuid,
  org_id uuid,
  owner_membership_id uuid,
  member_membership_id uuid,
  mailbox_id uuid,
  thread_id uuid,
  message_id uuid
) on commit drop;

grant all on table _email_rls_fixture to authenticated;

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
    p_email, extensions.crypt('email-rls-test', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('display_name', p_name), now(), now(), '', '', '', ''
  );
  return created_id;
end;
$$;

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

insert into _email_rls_fixture (owner_id, member_id)
values (
  pg_temp.make_auth_user('email-rls-owner@example.test', 'Email RLS Owner'),
  pg_temp.make_auth_user('email-rls-member@example.test', 'Email RLS Member')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Email RLS Org',
    'email-rls-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
)
update _email_rls_fixture
set org_id = created_org.id
from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _email_rls_fixture;

insert into public.memberships (org_id, user_id, role, status)
select org_id, member_id, 'member', 'active' from _email_rls_fixture;

update _email_rls_fixture
set
  owner_membership_id = (
    select m.id from public.memberships m
    where m.org_id = _email_rls_fixture.org_id
      and m.user_id = _email_rls_fixture.owner_id
  ),
  member_membership_id = (
    select m.id from public.memberships m
    where m.org_id = _email_rls_fixture.org_id
      and m.user_id = _email_rls_fixture.member_id
  );

-- Seed as privileged role (no authenticated INSERT grants on mailbox/email tables).
with created_mailbox as (
  insert into public.mailbox_accounts (
    org_id, membership_id, email_address, from_name,
    imap_host, imap_port, imap_security,
    smtp_host, smtp_port, smtp_security,
    username, status, created_by, updated_by
  )
  select
    org_id, owner_membership_id, 'owner-rls@example.test', 'Owner',
    'imap.example.test', 993, 'tls',
    'smtp.example.test', 587, 'starttls',
    'owner-rls@example.test', 'active', owner_id, owner_id
  from _email_rls_fixture
  returning id
)
update _email_rls_fixture
set mailbox_id = created_mailbox.id
from created_mailbox;

with created_thread as (
  insert into public.email_threads (
    org_id, mailbox_account_id, owner_membership_id,
    subject_normalized, message_count, created_by, updated_by
  )
  select
    org_id, mailbox_id, owner_membership_id,
    'private thread', 1, owner_id, owner_id
  from _email_rls_fixture
  returning id
)
update _email_rls_fixture
set thread_id = created_thread.id
from created_thread;

with created_message as (
  insert into public.email_messages (
    org_id, mailbox_account_id, owner_membership_id, thread_id,
    direction, status, from_address, to_addresses,
    subject, body_text, preview_text, received_at,
    created_by, updated_by
  )
  select
    org_id, mailbox_id, owner_membership_id, thread_id,
    'inbound', 'received', 'client@example.test',
    jsonb_build_array('owner-rls@example.test'),
    'Private mail', 'Secret body', 'Private mail', now(),
    owner_id, owner_id
  from _email_rls_fixture
  returning id
)
update _email_rls_fixture
set message_id = created_message.id
from created_message;

-- C1/C2: owner direct SELECT works (executable helpers, no recursion).
select pg_temp.as_user((select owner_id from _email_rls_fixture));
set local role authenticated;

select lives_ok(
  $$
    select id from public.email_messages
    where id = (select message_id from _email_rls_fixture)
  $$,
  'C1/C2: owner direct SELECT on email_messages does not error'
);

select isnt_empty(
  $$
    select id from public.email_messages
    where id = (select message_id from _email_rls_fixture)
  $$,
  'owner can read own email_messages via RLS'
);

select lives_ok(
  $$
    select id from public.email_threads
    where id = (select thread_id from _email_rls_fixture)
  $$,
  'C1/C2: owner direct SELECT on email_threads does not error'
);

select isnt_empty(
  $$
    select id from public.email_threads
    where id = (select thread_id from _email_rls_fixture)
  $$,
  'owner can read own email_threads via RLS'
);

select lives_ok(
  $$
    select message_id from public.email_message_links
    where message_id = (select message_id from _email_rls_fixture)
  $$,
  'C2: email_message_links SELECT does not recurse'
);

-- C3: owner can mark own visible message as read.
select lives_ok(
  $$
    insert into public.email_message_reads (org_id, message_id, membership_id)
    select org_id, message_id, owner_membership_id
    from _email_rls_fixture
  $$,
  'C3: owner can insert read marker for visible own message'
);

-- Member cannot read owner private mail (direct SELECT).
select pg_temp.as_user((select member_id from _email_rls_fixture));
set local role authenticated;

select is_empty(
  $$
    select id from public.email_messages
    where id = (select message_id from _email_rls_fixture)
  $$,
  'member cannot direct-SELECT owner private email_messages'
);

select is_empty(
  $$
    select id from public.email_threads
    where id = (select thread_id from _email_rls_fixture)
  $$,
  'member cannot direct-SELECT owner private email_threads'
);

select lives_ok(
  $$
    select id from public.email_messages
    where org_id = (select org_id from _email_rls_fixture)
  $$,
  'member listing email_messages does not raise recursion/permission errors'
);

-- C3: read-marker insert requires visibility (closes existence oracle).
select throws_ok(
  $$
    insert into public.email_message_reads (org_id, message_id, membership_id)
    select org_id, message_id, member_membership_id
    from _email_rls_fixture
  $$,
  '42501',
  null,
  'C3: member cannot insert read marker for invisible private message'
);

select ok(
  has_function_privilege(
    'authenticated',
    'private.current_membership_id(uuid)',
    'execute'
  ),
  'C1: authenticated can execute private.current_membership_id'
);

select ok(
  has_function_privilege(
    'authenticated',
    'private.message_visible_to_current_member(uuid, uuid)',
    'execute'
  ),
  'C1: authenticated can execute message_visible helper'
);

reset role;

select * from finish();

rollback;

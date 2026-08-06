begin;

select plan(6);

create temporary table _draft_vis_fixture (
  owner_id uuid,
  member_id uuid,
  org_id uuid,
  owner_membership_id uuid,
  member_membership_id uuid,
  mailbox_id uuid,
  message_id uuid,
  contact_id uuid
);

grant all on table _draft_vis_fixture to authenticated;

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
    extensions.crypt('draft-vis-test-password', extensions.gen_salt('bf')),
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

insert into _draft_vis_fixture (owner_id, member_id)
values (
  pg_temp.make_auth_user('draft-vis-owner@example.test', 'Draft Vis Owner'),
  pg_temp.make_auth_user('draft-vis-member@example.test', 'Draft Vis Member')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Draft Vis Org',
    'draft-vis-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
)
update _draft_vis_fixture
set org_id = created_org.id
from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _draft_vis_fixture;

insert into public.memberships (org_id, user_id, role, status)
select org_id, member_id, 'member', 'active' from _draft_vis_fixture;

update _draft_vis_fixture
set
  owner_membership_id = (
    select m.id
    from public.memberships m
    where m.org_id = _draft_vis_fixture.org_id
      and m.user_id = _draft_vis_fixture.owner_id
  ),
  member_membership_id = (
    select m.id
    from public.memberships m
    where m.org_id = _draft_vis_fixture.org_id
      and m.user_id = _draft_vis_fixture.member_id
  );

with created_mailbox as (
  insert into public.mailbox_accounts (
    org_id, membership_id, email_address, from_name,
    imap_host, imap_port, imap_security,
    smtp_host, smtp_port, smtp_security,
    username, status, created_by, updated_by
  )
  select
    org_id, owner_membership_id, 'owner@example.test', 'Owner',
    'imap.example.test', 993, 'tls',
    'smtp.example.test', 587, 'starttls',
    'owner@example.test', 'active', owner_id, owner_id
  from _draft_vis_fixture
  returning id
)
update _draft_vis_fixture
set mailbox_id = created_mailbox.id
from created_mailbox;

with created_contact as (
  insert into public.contacts (org_id, display_name, primary_email, created_by, updated_by)
  select org_id, 'Peer Contact', 'peer@example.test', owner_id, owner_id
  from _draft_vis_fixture
  returning id
)
update _draft_vis_fixture
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
    'inbound', 'received', 'peer@example.test',
    jsonb_build_array('owner@example.test'),
    'Visibility check',
    'Private body for Wave B.1 draft visibility.',
    'Private body for Wave B.1 draft visibility.',
    now(),
    owner_id, owner_id
  from _draft_vis_fixture
  returning id
)
update _draft_vis_fixture
set message_id = created_message.id
from created_message;

insert into public.email_message_links (
  org_id, message_id, entity_type, entity_id, link_reason, created_by
)
select org_id, message_id, 'contact', contact_id, 'address_match', owner_id
from _draft_vis_fixture;

select ok(
  (
    select prosrc ~ 'timeline_share'
      and prosrc ~ 'owner_membership_id'
      and prosrc ~ 'Email message not found'
    from pg_proc
    where oid = 'public.create_email_reply_suggestion(uuid, uuid, text, text, text, text, text, text)'::regprocedure
  ),
  'create_email_reply_suggestion source gates on owner or timeline_share'
);

select ok(
  (
    select prosrc !~ 'email_messages'
      and prosrc !~ 'body_text'
    from pg_proc
    where oid = 'public.decide_ai_suggestion(uuid, uuid, text, text)'::regprocedure
  ),
  'decide_ai_suggestion does not load source message body'
);

select pg_temp.as_user((select owner_id from _draft_vis_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.create_email_reply_suggestion(
      (select org_id from _draft_vis_fixture),
      (select message_id from _draft_vis_fixture),
      '',
      'openrouter',
      'wave-b1-test',
      'neutral'
    )
  $$,
  'mailbox owner can create email reply suggestion'
);

select pg_temp.as_user((select member_id from _draft_vis_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.create_email_reply_suggestion(
      (select org_id from _draft_vis_fixture),
      (select message_id from _draft_vis_fixture),
      '',
      'openrouter',
      'wave-b1-test',
      'neutral'
    )
  $$,
  'P0002',
  null,
  'second member denied on address_match-only message (404)'
);

reset role;

insert into public.email_message_links (
  org_id, message_id, entity_type, entity_id, link_reason, created_by
)
select org_id, message_id, 'contact', contact_id, 'timeline_share', owner_id
from _draft_vis_fixture;

select pg_temp.as_user((select member_id from _draft_vis_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.create_email_reply_suggestion(
      (select org_id from _draft_vis_fixture),
      (select message_id from _draft_vis_fixture),
      '',
      'openrouter',
      'wave-b1-test',
      'warm'
    )
  $$,
  'second member can draft after timeline_share'
);

reset role;

select ok(
  (
    select count(*) = 2
      and bool_and(status = 'ready')
      and bool_and(output_text is not null and length(output_text) > 0)
    from public.ai_suggestions
    where org_id = (select org_id from _draft_vis_fixture)
      and source_email_message_id = (select message_id from _draft_vis_fixture)
  ),
  'owner + shared-member drafts persisted with synthesized text'
);

select * from finish();
rollback;

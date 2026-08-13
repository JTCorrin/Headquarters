begin;

select plan(14);

select has_table('public', 'email_templates', 'email_templates table exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.email_templates'::regclass),
  'email_templates have RLS enabled'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'email_templates'
      and indexname = 'email_templates_org_name_uidx'
  ),
  'template names are unique per organisation among active rows'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'email_messages_template_fk'
  ),
  'email_messages.template_id FK to email_templates exists'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.list_my_email_messages(uuid, integer, timestamptz, uuid)',
    'execute'
  ),
  'authenticated can execute list_my_email_messages'
);

create temporary table _tpl_fixture (
  owner_id uuid,
  member_id uuid,
  outsider_id uuid,
  org_id uuid,
  other_org_id uuid,
  owner_membership_id uuid,
  member_membership_id uuid,
  template_id uuid,
  mailbox_id uuid,
  message_id uuid
) on commit drop;

grant all on table _tpl_fixture to authenticated;

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
    extensions.crypt('tpl-test-password', extensions.gen_salt('bf')),
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

insert into _tpl_fixture (owner_id, member_id, outsider_id)
values (
  pg_temp.make_auth_user('tpl-owner@example.test', 'Tpl Owner'),
  pg_temp.make_auth_user('tpl-member@example.test', 'Tpl Member'),
  pg_temp.make_auth_user('tpl-outsider@example.test', 'Tpl Outsider')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Templates Org',
    'tpl-org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
),
other_org as (
  insert into public.organisations (name, slug, country_code)
  values (
    'Other Templates Org',
    'other-tpl-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB'
  )
  returning id
)
update _tpl_fixture
set
  org_id = created_org.id,
  other_org_id = other_org.id
from created_org, other_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _tpl_fixture;

insert into public.memberships (org_id, user_id, role, status)
select org_id, member_id, 'member', 'active' from _tpl_fixture;

insert into public.memberships (org_id, user_id, role, status)
select other_org_id, outsider_id, 'owner', 'active' from _tpl_fixture;

update _tpl_fixture
set
  owner_membership_id = (
    select m.id from public.memberships m
    where m.org_id = _tpl_fixture.org_id
      and m.user_id = _tpl_fixture.owner_id
  ),
  member_membership_id = (
    select m.id from public.memberships m
    where m.org_id = _tpl_fixture.org_id
      and m.user_id = _tpl_fixture.member_id
  );

-- Seed mailbox + message as migration owner (no authenticated INSERT grants).
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
  from _tpl_fixture
  returning id
)
update _tpl_fixture
set mailbox_id = created_mailbox.id
from created_mailbox;

with created_message as (
  insert into public.email_messages (
    org_id, mailbox_account_id, owner_membership_id, direction, status,
    from_address, to_addresses, subject, body_text, preview_text, received_at,
    created_by, updated_by
  )
  select
    org_id, mailbox_id, owner_membership_id, 'inbound', 'received',
    'client@example.test', jsonb_build_array('owner@example.test'),
    'Hello inbox', 'Body', 'Hello inbox', now(),
    owner_id, owner_id
  from _tpl_fixture
  returning id
)
update _tpl_fixture
set message_id = created_message.id
from created_message;

select pg_temp.as_user((select owner_id from _tpl_fixture));
set local role authenticated;

select lives_ok(
  $$
    insert into public.email_templates (
      org_id, name, subject, body_text, category, status, merge_schema
    )
    select
      org_id,
      'Welcome',
      'Hello {{name}}',
      'Welcome aboard',
      'onboarding',
      'active',
      '["name"]'::jsonb
    from _tpl_fixture
  $$,
  'owner can insert an email template'
);

update _tpl_fixture
set template_id = email_templates.id
from public.email_templates
where email_templates.org_id = (select org_id from _tpl_fixture)
  and email_templates.name = 'Welcome'
  and email_templates.deleted_at is null;

select is(
  (select status from public.email_templates where id = (select template_id from _tpl_fixture)),
  'active',
  'template status is active'
);

reset role;
select pg_temp.as_user((select member_id from _tpl_fixture));
set local role authenticated;

select lives_ok(
  $$
    insert into public.email_templates (
      org_id, name, subject, category, status
    )
    select org_id, 'Member Welcome', 'Hello', 'other', 'draft' from _tpl_fixture
  $$,
  'member can insert email templates'
);

reset role;
select pg_temp.as_user((select owner_id from _tpl_fixture));
set local role authenticated;

select throws_ok(
  $$
    select pg_temp.as_user(outsider_id) from _tpl_fixture;
    insert into public.email_templates (
      org_id, name, subject, category, status
    )
    select org_id, 'Cross', 'Nope', 'other', 'draft' from _tpl_fixture
  $$,
  '42501',
  null,
  'cross-org template insert is denied'
);

select throws_ok(
  $$
    select pg_temp.as_user(owner_id) from _tpl_fixture;
    insert into public.email_templates (
      org_id, name, subject, category, status
    )
    select org_id, 'welcome', 'Dup', 'other', 'draft' from _tpl_fixture
  $$,
  '23505',
  null,
  'duplicate template name (case-insensitive) is rejected'
);

select is(
  (
    select jsonb_array_length(
      public.list_my_email_messages((select org_id from _tpl_fixture), 50)
    )
  ),
  1,
  'owner personal inbox lists their message'
);

select ok(
  (
    select (public.list_my_email_messages((select org_id from _tpl_fixture), 50) -> 0 ->> 'id')
      = (select message_id::text from _tpl_fixture)
  ),
  'personal inbox returns the seeded message id'
);

select pg_temp.as_user((select member_id from _tpl_fixture));

select is(
  (
    select jsonb_array_length(
      public.list_my_email_messages((select org_id from _tpl_fixture), 50)
    )
  ),
  0,
  'member does not see owner mailbox messages in personal inbox'
);

select throws_ok(
  $$
    select pg_temp.as_user(outsider_id) from _tpl_fixture;
    select public.list_my_email_messages((select org_id from _tpl_fixture), 50)
  $$,
  '42501',
  'Forbidden',
  'cross-org personal inbox is denied'
);

select * from finish();
rollback;

-- Mailbox catch-up cursor, CC/domain matching, public-domain skip.

begin;

select plan(10);

select has_column('public', 'mailbox_accounts', 'sync_catchup_complete', 'mailbox cursor catchup flag');
select has_column('public', 'clients', 'email_domain', 'clients have email_domain');
select has_column('public', 'email_messages', 'imap_uid', 'email_messages store imap_uid');

select ok(
  private.is_public_email_domain('gmail.com'),
  'gmail.com is a public mailbox domain'
);

select is(
  private.derive_email_domain('billing@hesis.co.uk', null)::text,
  'hesis.co.uk',
  'derive domain from primary email'
);

select is(
  private.derive_email_domain('someone@gmail.com', null)::text,
  null,
  'public mailbox domain is not used without a website fallback'
);

select is(
  private.derive_email_domain('someone@gmail.com', 'https://www.acme.test/about')::text,
  'acme.test',
  'public email falls back to website host'
);

create temporary table _mail_match_fixture (
  owner_id uuid,
  org_id uuid,
  owner_membership_id uuid,
  mailbox_id uuid,
  contact_id uuid,
  client_id uuid
) on commit drop;

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
    created_id,
    'authenticated',
    'authenticated',
    p_email,
    extensions.crypt('mail-match-fixture', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('display_name', p_name),
    now(), now(), '', '', '', ''
  );
  return created_id;
end;
$$;

insert into _mail_match_fixture (owner_id)
values (pg_temp.make_auth_user('mail-match-owner@example.test', 'Mail Match Owner'));

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Mail Match Org',
    'mail-match-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
)
update _mail_match_fixture
set org_id = created_org.id
from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _mail_match_fixture;

update _mail_match_fixture
set owner_membership_id = (
  select m.id from public.memberships m
  where m.org_id = _mail_match_fixture.org_id
    and m.user_id = _mail_match_fixture.owner_id
);

with created_mailbox as (
  insert into public.mailbox_accounts (
    org_id, membership_id, email_address, from_name,
    imap_host, imap_port, imap_security,
    smtp_host, smtp_port, smtp_security,
    username, status, created_by, updated_by
  )
  select
    org_id, owner_membership_id, 'mail-match-owner@example.test', 'Owner',
    'imap.example.test', 993, 'tls',
    'smtp.example.test', 587, 'starttls',
    'mail-match-owner@example.test', 'active', owner_id, owner_id
  from _mail_match_fixture
  returning id
)
update _mail_match_fixture
set mailbox_id = created_mailbox.id
from created_mailbox;

with created_client as (
  insert into public.clients (
    org_id, name, status, primary_email, created_by, updated_by
  )
  select
    org_id, 'Hesis', 'active', 'billing@hesis.co.uk', owner_id, owner_id
  from _mail_match_fixture
  returning id
)
update _mail_match_fixture
set client_id = created_client.id
from created_client;

with created_contact as (
  insert into public.contacts (
    org_id, display_name, primary_email, created_by, updated_by
  )
  select
    org_id, 'Daniel Taylor', 'daniel.taylor@hesis.co.uk', owner_id, owner_id
  from _mail_match_fixture
  returning id
)
update _mail_match_fixture
set contact_id = created_contact.id
from created_contact;

select is(
  (select email_domain::text from public.clients c join _mail_match_fixture f on f.client_id = c.id),
  'hesis.co.uk',
  'client email_domain auto-fills from primary_email'
);

do $$
declare
  f _mail_match_fixture%rowtype;
  upserted jsonb;
begin
  select * into f from _mail_match_fixture;

  upserted := public.upsert_inbound_email_message(
    f.org_id,
    f.mailbox_id,
    'cc-daniel-1',
    'thread-cc-1',
    'someone@other.test',
    'Other',
    '[{"email":"mail-match-owner@example.test"}]'::jsonb,
    'CC thread',
    'Hello',
    'Hello',
    now(),
    false,
    null,
    '[{"email":"daniel.taylor@hesis.co.uk"}]'::jsonb,
    '{}'::jsonb,
    41
  );

  upserted := public.upsert_inbound_email_message(
    f.org_id,
    f.mailbox_id,
    'domain-colleague-1',
    'thread-domain-1',
    'ops@hesis.co.uk',
    'Ops',
    '[{"email":"mail-match-owner@example.test"}]'::jsonb,
    'Domain mail',
    'Hello domain',
    'Hello domain',
    now(),
    false
  );
end;
$$;

select ok(
  exists (
    select 1
    from public.email_message_links l
    join _mail_match_fixture f on f.contact_id = l.entity_id
    join public.email_messages m on m.id = l.message_id
    where l.entity_type = 'contact'
      and l.link_reason = 'address_match'
      and m.provider_message_id = 'cc-daniel-1'
  ),
  'CC address links the contact'
);

select ok(
  exists (
    select 1
    from public.email_message_links l
    join _mail_match_fixture f on f.client_id = l.entity_id
    join public.email_messages m on m.id = l.message_id
    where l.entity_type = 'client'
      and l.link_reason = 'domain_match'
      and m.provider_message_id = 'domain-colleague-1'
  ),
  'client domain_match links colleague mail'
);

select * from finish();

rollback;

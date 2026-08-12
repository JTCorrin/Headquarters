-- leads.primary_email: column, grants, and inbox address_match without contact_id.

begin;

select plan(5);

select has_column('public', 'leads', 'primary_email', 'leads have primary_email');

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'leads'
      and indexname = 'leads_org_email_idx'
  ),
  'leads_org_email_idx exists'
);

select ok(
  exists (
    select 1
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'leads'
      and column_name = 'primary_email'
      and grantee = 'authenticated'
      and privilege_type = 'INSERT'
  ),
  'authenticated can insert leads.primary_email'
);

select ok(
  exists (
    select 1
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'leads'
      and column_name = 'primary_email'
      and grantee = 'authenticated'
      and privilege_type = 'UPDATE'
  ),
  'authenticated can update leads.primary_email'
);

create temporary table _lead_email_fixture (
  owner_id uuid,
  org_id uuid,
  owner_membership_id uuid,
  mailbox_id uuid,
  lead_id uuid,
  message_id uuid
) on commit drop;

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
    extensions.crypt('lead-email-fixture', extensions.gen_salt('bf')),
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

insert into _lead_email_fixture (owner_id)
values (pg_temp.make_auth_user('lead-email-owner@example.test', 'Lead Email Owner'));

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Lead Email Org',
    'lead-email-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
)
update _lead_email_fixture
set org_id = created_org.id
from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _lead_email_fixture;

update _lead_email_fixture
set owner_membership_id = (
  select m.id from public.memberships m
  where m.org_id = _lead_email_fixture.org_id
    and m.user_id = _lead_email_fixture.owner_id
);

with created_mailbox as (
  insert into public.mailbox_accounts (
    org_id, membership_id, email_address, from_name,
    imap_host, imap_port, imap_security,
    smtp_host, smtp_port, smtp_security,
    username, status, created_by, updated_by
  )
  select
    org_id, owner_membership_id, 'lead-email-owner@example.test', 'Owner',
    'imap.example.test', 993, 'tls',
    'smtp.example.test', 587, 'starttls',
    'lead-email-owner@example.test', 'active', owner_id, owner_id
  from _lead_email_fixture
  returning id
)
update _lead_email_fixture
set mailbox_id = created_mailbox.id
from created_mailbox;

with created_lead as (
  insert into public.leads (
    org_id, name, primary_email, stage, currency, created_by, updated_by
  )
  select
    org_id, 'Inbound lead', 'prospect@example.test', 'new', 'GBP', owner_id, owner_id
  from _lead_email_fixture
  returning id
)
update _lead_email_fixture
set lead_id = created_lead.id
from created_lead;

do $$
declare
  f _lead_email_fixture%rowtype;
  upserted jsonb;
begin
  select * into f from _lead_email_fixture;
  upserted := public.upsert_inbound_email_message(
    f.org_id,
    f.mailbox_id,
    'lead-email-provider-msg-1',
    'lead-email-thread-1',
    'prospect@example.test',
    'Prospect',
    '[{"email":"lead-email-owner@example.test"}]'::jsonb,
    'Hello from prospect',
    'Body',
    'Preview',
    now(),
    false
  );
  update _lead_email_fixture
  set message_id = (upserted ->> 'id')::uuid;
end;
$$;

select ok(
  exists (
    select 1
    from public.email_message_links l
    join _lead_email_fixture f
      on f.message_id = l.message_id
     and f.lead_id = l.entity_id
    where l.entity_type = 'lead'
      and l.link_reason = 'address_match'
  ),
  'inbound sync links lead by primary_email without contact_id'
);

select * from finish();

rollback;

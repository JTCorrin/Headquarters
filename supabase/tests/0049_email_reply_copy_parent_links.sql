begin;

select plan(6);

create temporary table _cer_fixture (
  owner_id uuid,
  org_id uuid,
  owner_membership_id uuid,
  mailbox_id uuid,
  client_id uuid,
  parent_id uuid,
  outbound_id uuid,
  idem_hash text
) on commit drop;

grant all on table _cer_fixture to authenticated;

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
    extensions.crypt('cer-password', extensions.gen_salt('bf')),
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

insert into _cer_fixture (owner_id, idem_hash)
values (
  pg_temp.make_auth_user('cer-owner@example.test', 'CER Owner'),
  encode(extensions.digest('cer-idem-' || gen_random_uuid()::text, 'sha256'), 'hex')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency, timezone)
  values (
    'CER Org',
    'cer-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP',
    'UTC'
  )
  returning id
)
update _cer_fixture set org_id = created_org.id from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _cer_fixture;

update _cer_fixture
set owner_membership_id = (
  select m.id from public.memberships m
  where m.org_id = _cer_fixture.org_id and m.user_id = _cer_fixture.owner_id
);

with created_mailbox as (
  insert into public.mailbox_accounts (
    org_id, membership_id, email_address, from_name,
    imap_host, imap_port, imap_security,
    smtp_host, smtp_port, smtp_security,
    username, status, created_by, updated_by
  )
  select
    org_id, owner_membership_id, 'cer-mail@example.test', 'CER Mailer',
    'imap.example.test', 993, 'tls',
    'smtp.example.test', 587, 'starttls',
    'cer-mail@example.test', 'active', owner_id, owner_id
  from _cer_fixture
  returning id
)
update _cer_fixture set mailbox_id = created_mailbox.id from created_mailbox;

with created_client as (
  insert into public.clients (
    org_id, name, primary_email, status, created_by, updated_by
  )
  select org_id, 'CER Client', 'peer-cer@example.test', 'active', owner_id, owner_id
  from _cer_fixture
  returning id
)
update _cer_fixture set client_id = created_client.id from created_client;

with created_parent as (
  insert into public.email_messages (
    org_id, mailbox_account_id, owner_membership_id,
    direction, status, provider, provider_message_id,
    from_address, to_addresses,
    subject, body_text, preview_text, received_at,
    created_by, updated_by
  )
  select
    org_id, mailbox_id, owner_membership_id,
    'inbound', 'received', 'imap', 'cer-parent-' || gen_random_uuid()::text,
    'peer-cer@example.test',
    jsonb_build_array(jsonb_build_object('email', 'cer-mail@example.test')),
    'CER parent subject',
    'Inbound body for reply link copy.',
    'Inbound body for reply link copy.',
    now() - interval '1 minute',
    owner_id, owner_id
  from _cer_fixture
  returning id
)
update _cer_fixture set parent_id = created_parent.id from created_parent;

insert into public.email_message_links (
  org_id, message_id, entity_type, entity_id, link_reason, created_by
)
select org_id, parent_id, 'client', client_id, 'address_match', owner_id
from _cer_fixture;

select pg_temp.as_user((select owner_id from _cer_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.begin_email_reply_idempotent(
      (select org_id from _cer_fixture),
      (select parent_id from _cer_fixture),
      (select idem_hash from _cer_fixture),
      encode(extensions.digest('cer-req-' || (select parent_id from _cer_fixture)::text, 'sha256'), 'hex'),
      '/api/v1/email-messages/' || (select parent_id from _cer_fixture)::text || '/reply'
    )
  $$,
  'begin_email_reply_idempotent claims for CER parent'
);

select lives_ok(
  $$
    select public.finish_email_reply_idempotent(
      (select org_id from _cer_fixture),
      (select parent_id from _cer_fixture),
      'Thanks — CER reply body.',
      null,
      'Re: CER parent subject',
      '<cer-outbound@example.test>',
      'sent',
      null,
      (select idem_hash from _cer_fixture)
    )
  $$,
  'finish_email_reply_idempotent inserts outbound reply'
);

update _cer_fixture
set outbound_id = m.id
from public.email_messages m
where m.org_id = _cer_fixture.org_id
  and m.in_reply_to_message_id = _cer_fixture.parent_id
  and m.direction = 'outbound'
  and m.deleted_at is null;

select ok(
  (select outbound_id from _cer_fixture) is not null,
  'outbound reply row exists'
);

select ok(
  exists (
    select 1
    from public.email_message_links l
    where l.message_id = (select outbound_id from _cer_fixture)
      and l.entity_type = 'client'
      and l.entity_id = (select client_id from _cer_fixture)
      and l.link_reason = 'address_match'
  ),
  'outbound reply linked to same client as parent'
);

select ok(
  (
    select count(*)::integer
    from jsonb_array_elements(
      public.list_entity_email_messages(
        (select org_id from _cer_fixture),
        'client',
        (select client_id from _cer_fixture),
        50
      )
    ) e
    where e ->> 'id' = (select outbound_id from _cer_fixture)::text
      and e ->> 'direction' = 'outbound'
      and e ->> 'sent_at' is not null
      and e -> 'to_addresses' is not null
      and jsonb_typeof(e -> 'to_addresses') = 'array'
      and jsonb_array_length(e -> 'to_addresses') >= 1
  ) = 1,
  'entity list includes outbound with sent_at and to_addresses'
);

select ok(
  (
    select count(*)::integer
    from jsonb_array_elements(
      public.list_entity_email_messages(
        (select org_id from _cer_fixture),
        'client',
        (select client_id from _cer_fixture),
        50
      )
    ) e
    where e ->> 'id' = (select parent_id from _cer_fixture)::text
  ) = 1,
  'entity list still includes inbound parent'
);

reset role;

select * from finish();

rollback;

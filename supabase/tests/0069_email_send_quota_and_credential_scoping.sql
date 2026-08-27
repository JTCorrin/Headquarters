begin;

select plan(15);

create temporary table _esq_fixture (
  owner_id uuid,
  member_id uuid,
  billing_id uuid,
  outsider_id uuid,
  org_id uuid,
  owner_membership_id uuid,
  member_membership_id uuid,
  mailbox_id uuid,
  client_id uuid,
  client_no_email_id uuid,
  inbound_message_id uuid,
  idem_hash text
) on commit drop;

grant all on table _esq_fixture to authenticated;

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
    extensions.crypt('esq-password', extensions.gen_salt('bf')),
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

insert into _esq_fixture (owner_id, member_id, billing_id, outsider_id, idem_hash)
values (
  pg_temp.make_auth_user('esq-owner@example.test', 'ESQ Owner'),
  pg_temp.make_auth_user('esq-member@example.test', 'ESQ Member'),
  pg_temp.make_auth_user('esq-billing@example.test', 'ESQ Billing'),
  pg_temp.make_auth_user('esq-outsider@example.test', 'ESQ Outsider'),
  encode(extensions.digest('esq-idem-' || gen_random_uuid()::text, 'sha256'), 'hex')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency, timezone)
  values (
    'ESQ Org',
    'esq-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP',
    'UTC'
  )
  returning id
)
update _esq_fixture set org_id = created_org.id from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _esq_fixture;

insert into public.memberships (org_id, user_id, role, status)
select org_id, member_id, 'member', 'active' from _esq_fixture;

insert into public.memberships (org_id, user_id, role, status)
select org_id, billing_id, 'billing', 'active' from _esq_fixture;

update _esq_fixture
set owner_membership_id = (
  select m.id from public.memberships m
  where m.org_id = _esq_fixture.org_id and m.user_id = _esq_fixture.owner_id
),
member_membership_id = (
  select m.id from public.memberships m
  where m.org_id = _esq_fixture.org_id and m.user_id = _esq_fixture.member_id
);

with created_mailbox as (
  insert into public.mailbox_accounts (
    org_id, membership_id, email_address, from_name,
    imap_host, imap_port, imap_security,
    smtp_host, smtp_port, smtp_security,
    username, status, created_by, updated_by
  )
  select
    org_id, owner_membership_id, 'esq-mail@example.test', 'ESQ Mailer',
    'imap.example.test', 993, 'tls',
    'smtp.example.test', 587, 'starttls',
    'esq-mail@example.test', 'active', owner_id, owner_id
  from _esq_fixture
  returning id
)
update _esq_fixture set mailbox_id = created_mailbox.id from created_mailbox;

with created_client as (
  insert into public.clients (
    org_id, name, primary_email, status, created_by, updated_by
  )
  select org_id, 'ESQ Client', 'peer-esq@example.test', 'active', owner_id, owner_id
  from _esq_fixture
  returning id
)
update _esq_fixture set client_id = created_client.id from created_client;

with created_client as (
  insert into public.clients (
    org_id, name, primary_email, status, created_by, updated_by
  )
  select org_id, 'ESQ Quiet Client', null, 'active', owner_id, owner_id
  from _esq_fixture
  returning id
)
update _esq_fixture set client_no_email_id = created_client.id from created_client;

-- Inbound parent for reply quota tests.
with created_message as (
  insert into public.email_messages (
    org_id, mailbox_account_id, owner_membership_id, thread_id,
    direction, status, provider, provider_message_id,
    from_address, to_addresses, subject, body_text, preview_text
  )
  select
    org_id, mailbox_id, owner_membership_id, null,
    'inbound', 'received', 'imap', 'esq-inbound-1',
    'sender-esq@example.test', jsonb_build_array(jsonb_build_object('email', 'esq-mail@example.test', 'name', null)),
    'ESQ inbound subject', 'Inbound body', 'Inbound body'
  from _esq_fixture
  returning id
)
update _esq_fixture set inbound_message_id = created_message.id from created_message;

select pg_temp.as_user((select owner_id from _esq_fixture));
set local role authenticated;

-- 1. Compose begin succeeds and returns the entity primary email as recipient.
select is(
  (
    select begin_email_compose_idempotent(
      (select org_id from _esq_fixture),
      'client',
      (select client_id from _esq_fixture),
      (select idem_hash from _esq_fixture),
      encode(extensions.digest('esq-req-1', 'sha256'), 'hex'),
      '/api/v1/clients/' || (select client_id from _esq_fixture)::text || '/email-messages'
    ) ->> 'to_address'
  ),
  'peer-esq@example.test',
  'compose begin defaults recipient to entity primary email'
);

-- 2. Finish consumes one quota unit for the mailbox.
select is(
  (
    select sent_count from public.email_send_quota_usage
    where mailbox_account_id = (select mailbox_id from _esq_fixture)
      and usage_date = (now() at time zone 'utc')::date
  ),
  0,
  'quota row not created before finish'
);

select lives_ok(
  $$
    select public.finish_email_compose_idempotent(
      (select org_id from _esq_fixture),
      'client',
      (select client_id from _esq_fixture),
      'peer-esq@example.test',
      'ESQ subject',
      'ESQ body',
      null,
      '<esq-outbound-1@example.test>',
      'sent',
      null,
      (select idem_hash from _esq_fixture)
    )
  $$,
  'finish_email_compose_idempotent records a sent compose'
);

select is(
  (
    select sent_count from public.email_send_quota_usage
    where mailbox_account_id = (select mailbox_id from _esq_fixture)
      and usage_date = (now() at time zone 'utc')::date
  ),
  1,
  'finish consumes one quota unit on success'
);

-- 3. Member (non-owner) may not opt into an external recipient.
select pg_temp.as_user((select member_id from _esq_fixture));

select throws_ok(
  $$
    select public.begin_email_compose_idempotent(
      (select org_id from _esq_fixture),
      'client',
      (select client_id from _esq_fixture),
      encode(extensions.digest('esq-member-ext', 'sha256'), 'hex'),
      encode(extensions.digest('esq-member-ext-req', 'sha256'), 'hex'),
      '/api/v1/clients/compose',
      86400,
      'elsewhere@example.test',
      true
    )
  $$,
  '22023',
  'Only owners and admins may send to non-entity recipients',
  'member cannot opt into external recipients'
);

-- 4. Member without allow flag cannot target an arbitrary address either.
select throws_ok(
  $$
    select public.begin_email_compose_idempotent(
      (select org_id from _esq_fixture),
      'client',
      (select client_id from _esq_fixture),
      encode(extensions.digest('esq-member-noext', 'sha256'), 'hex'),
      encode(extensions.digest('esq-member-noext-req', 'sha256'), 'hex'),
      '/api/v1/clients/compose',
      86400,
      'elsewhere@example.test',
      false
    )
  $$,
  '22023',
  'Recipient must match the entity primary email',
  'compose rejects non-entity recipient without allow flag'
);

-- 5. Entity without primary email and no recipient fails validation.
select throws_ok(
  $$
    select public.begin_email_compose_idempotent(
      (select org_id from _esq_fixture),
      'client',
      (select client_no_email_id from _esq_fixture),
      encode(extensions.digest('esq-noemail', 'sha256'), 'hex'),
      encode(extensions.digest('esq-noemail-req', 'sha256'), 'hex'),
      '/api/v1/clients/compose'
    )
  $$,
  '22023',
  'Recipient address is required',
  'compose requires a recipient when entity has no primary email'
);

-- 6. Owner may send to an external recipient with the allow flag.
select pg_temp.as_user((select owner_id from _esq_fixture));

select is(
  (
    select begin_email_compose_idempotent(
      (select org_id from _esq_fixture),
      'client',
      (select client_id from _esq_fixture),
      encode(extensions.digest('esq-owner-ext', 'sha256'), 'hex'),
      encode(extensions.digest('esq-owner-ext-req', 'sha256'), 'hex'),
      '/api/v1/clients/compose',
      86400,
      'Elsewhere@Example.test',
      true
    ) ->> 'to_address'
  ),
  'elsewhere@example.test',
  'owner with allow flag may target external recipient'
);

-- 7. Reply quota: begin + finish consume units on the same mailbox counter.
select lives_ok(
  $$
    select public.begin_email_reply_idempotent(
      (select org_id from _esq_fixture),
      (select inbound_message_id from _esq_fixture),
      encode(extensions.digest('esq-reply-idem', 'sha256'), 'hex'),
      encode(extensions.digest('esq-reply-req', 'sha256'), 'hex'),
      '/api/v1/email-messages/reply'
    )
  $$,
  'reply begin succeeds under quota'
);

select lives_ok(
  $$
    select public.finish_email_reply_idempotent(
      (select org_id from _esq_fixture),
      (select inbound_message_id from _esq_fixture),
      'Reply body',
      null,
      'Re: ESQ inbound subject',
      '<esq-outbound-reply@example.test>',
      'sent',
      null,
      encode(extensions.digest('esq-reply-idem', 'sha256'), 'hex')
    )
  $$,
  'reply finish records a sent reply'
);

select is(
  (
    select sent_count from public.email_send_quota_usage
    where mailbox_account_id = (select mailbox_id from _esq_fixture)
      and usage_date = (now() at time zone 'utc')::date
  ),
  2,
  'reply finish consumes a second quota unit'
);

-- 8. Exhausting the quota blocks new sends with 55006.
update public.email_send_quota_usage
set sent_count = (select limit_value from (select 200 as limit_value) limits)
where mailbox_account_id = (select mailbox_id from _esq_fixture)
  and usage_date = (now() at time zone 'utc')::date;

select throws_ok(
  $$
    select public.begin_email_compose_idempotent(
      (select org_id from _esq_fixture),
      'client',
      (select client_id from _esq_fixture),
      encode(extensions.digest('esq-over-quota', 'sha256'), 'hex'),
      encode(extensions.digest('esq-over-quota-req', 'sha256'), 'hex'),
      '/api/v1/clients/compose'
    )
  $$,
  '55006',
  'Daily email send limit reached for this mailbox',
  'compose begin is blocked once the daily quota is exhausted'
);

select throws_ok(
  $$
    select public.begin_email_reply_idempotent(
      (select org_id from _esq_fixture),
      (select inbound_message_id from _esq_fixture),
      encode(extensions.digest('esq-reply-quota', 'sha256'), 'hex'),
      encode(extensions.digest('esq-reply-quota-req', 'sha256'), 'hex'),
      '/api/v1/email-messages/reply'
    )
  $$,
  '55006',
  'Daily email send limit reached for this mailbox',
  'reply begin is blocked once the daily quota is exhausted'
);

-- 9. Credential read is org-scoped for user-backed callers.
select throws_ok(
  $$
    select public.read_mailbox_sync_credentials(
      (select mailbox_id from _esq_fixture),
      (select org_id from _esq_fixture)
    )
  $$,
  'P0002',
  'Mailbox not found',
  'org-scoped credential read requires an authenticated caller'
);

reset role;
select pg_temp.as_user((select member_id from _esq_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.read_mailbox_sync_credentials(
      (select mailbox_id from _esq_fixture),
      (select org_id from _esq_fixture)
    )
  $$,
  '42501',
  'Forbidden',
  'credential read rejects a caller whose membership does not own the mailbox'
);

reset role;
select pg_temp.as_user((select owner_id from _esq_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.read_mailbox_sync_credentials(
      (select mailbox_id from _esq_fixture),
      (select org_id from _esq_fixture)
    )
  $$,
  'credential read succeeds for the owning member'
);

-- 10. Quota table is not writable directly by authenticated roles.
select throws_ok(
  $$
    insert into public.email_send_quota_usage (
      org_id, mailbox_account_id, usage_date, sent_count
    )
    select org_id, mailbox_id, (now() at time zone 'utc')::date, 999
    from _esq_fixture
  $$,
  '42501',
  null,
  'authenticated cannot write quota counters directly'
);

select * from finish();

rollback;

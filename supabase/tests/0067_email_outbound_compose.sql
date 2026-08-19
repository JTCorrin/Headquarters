begin;

select plan(14);

create temporary table _cec_fixture (
  owner_id uuid,
  member_id uuid,
  billing_id uuid,
  org_id uuid,
  owner_membership_id uuid,
  mailbox_id uuid,
  client_id uuid,
  outbound_id uuid,
  suggestion_id uuid,
  idem_hash text
) on commit drop;

grant all on table _cec_fixture to authenticated;

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
    extensions.crypt('cec-password', extensions.gen_salt('bf')),
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

insert into _cec_fixture (owner_id, member_id, billing_id, idem_hash)
values (
  pg_temp.make_auth_user('cec-owner@example.test', 'CEC Owner'),
  pg_temp.make_auth_user('cec-member@example.test', 'CEC Member'),
  pg_temp.make_auth_user('cec-billing@example.test', 'CEC Billing'),
  encode(extensions.digest('cec-idem-' || gen_random_uuid()::text, 'sha256'), 'hex')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency, timezone)
  values (
    'CEC Org',
    'cec-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP',
    'UTC'
  )
  returning id
)
update _cec_fixture set org_id = created_org.id from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _cec_fixture;

insert into public.memberships (org_id, user_id, role, status)
select org_id, member_id, 'member', 'active' from _cec_fixture;

insert into public.memberships (org_id, user_id, role, status)
select org_id, billing_id, 'billing', 'active' from _cec_fixture;

update _cec_fixture
set owner_membership_id = (
  select m.id from public.memberships m
  where m.org_id = _cec_fixture.org_id and m.user_id = _cec_fixture.owner_id
);

with created_mailbox as (
  insert into public.mailbox_accounts (
    org_id, membership_id, email_address, from_name,
    imap_host, imap_port, imap_security,
    smtp_host, smtp_port, smtp_security,
    username, status, created_by, updated_by
  )
  select
    org_id, owner_membership_id, 'cec-mail@example.test', 'CEC Mailer',
    'imap.example.test', 993, 'tls',
    'smtp.example.test', 587, 'starttls',
    'cec-mail@example.test', 'active', owner_id, owner_id
  from _cec_fixture
  returning id
)
update _cec_fixture set mailbox_id = created_mailbox.id from created_mailbox;

with created_client as (
  insert into public.clients (
    org_id, name, primary_email, status, created_by, updated_by
  )
  select org_id, 'CEC Client', 'peer-cec@example.test', 'active', owner_id, owner_id
  from _cec_fixture
  returning id
)
update _cec_fixture set client_id = created_client.id from created_client;

select ok(
  has_function_privilege(
    'authenticated',
    'public.begin_email_compose_idempotent(uuid, text, uuid, text, text, text, integer)',
    'execute'
  ),
  'authenticated can execute begin_email_compose_idempotent'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.abort_email_compose_idempotent(uuid, text)',
    'execute'
  ),
  'authenticated can execute abort_email_compose_idempotent'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.finish_email_compose_idempotent(uuid, text, uuid, text, text, text, text, text, text, text, text)',
    'execute'
  ),
  'authenticated can execute finish_email_compose_idempotent'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_email_compose_suggestion(uuid, text, uuid, text, text, text, text, text)',
    'execute'
  ),
  'authenticated can execute create_email_compose_suggestion'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.begin_email_compose_idempotent(uuid, text, uuid, text, text, text, integer)',
    'execute'
  ),
  'anon cannot execute begin_email_compose_idempotent'
);

select pg_temp.as_user((select owner_id from _cec_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.begin_email_compose_idempotent(
      (select org_id from _cec_fixture),
      'client',
      (select client_id from _cec_fixture),
      (select idem_hash from _cec_fixture),
      encode(extensions.digest('cec-req-' || (select client_id from _cec_fixture)::text, 'sha256'), 'hex'),
      '/api/v1/clients/' || (select client_id from _cec_fixture)::text || '/email-messages'
    )
  $$,
  'begin_email_compose_idempotent claims for client compose'
);

select lives_ok(
  $$
    select public.finish_email_compose_idempotent(
      (select org_id from _cec_fixture),
      'client',
      (select client_id from _cec_fixture),
      'peer-cec@example.test',
      'Hello from compose',
      'Thanks — CEC compose body.',
      null,
      '<cec-outbound@example.test>',
      'sent',
      null,
      (select idem_hash from _cec_fixture)
    )
  $$,
  'finish_email_compose_idempotent inserts outbound compose'
);

update _cec_fixture
set outbound_id = m.id
from public.email_messages m
where m.org_id = _cec_fixture.org_id
  and m.direction = 'outbound'
  and m.provider_message_id = '<cec-outbound@example.test>'
  and m.deleted_at is null;

select ok(
  (select outbound_id from _cec_fixture) is not null,
  'outbound compose row exists'
);

select ok(
  exists (
    select 1
    from public.email_message_links l
    where l.message_id = (select outbound_id from _cec_fixture)
      and l.entity_type = 'client'
      and l.entity_id = (select client_id from _cec_fixture)
      and l.link_reason = 'address_match'
  ),
  'compose message is linked to the entity with address_match'
);

select ok(
  (
    select count(*)::integer
    from jsonb_array_elements(
      public.list_entity_email_messages(
        (select org_id from _cec_fixture),
        'client',
        (select client_id from _cec_fixture),
        50
      )
    ) e
    where e ->> 'id' = (select outbound_id from _cec_fixture)::text
      and e ->> 'direction' = 'outbound'
  ) = 1,
  'entity list includes compose outbound'
);

select lives_ok(
  $$
    select public.create_email_compose_suggestion(
      (select org_id from _cec_fixture),
      'client',
      (select client_id from _cec_fixture),
      'Hi — draft compose body.',
      'stub',
      'stub-model',
      'warm',
      'ai-prompts-v1:test'
    )
  $$,
  'create_email_compose_suggestion inserts email_compose kind'
);

update _cec_fixture
set suggestion_id = s.id
from public.ai_suggestions s
where s.org_id = _cec_fixture.org_id
  and s.kind = 'email_compose'
  and s.entity_id = _cec_fixture.client_id
  and s.deleted_at is null;

select is(
  (
    select kind from public.ai_suggestions
    where id = (select suggestion_id from _cec_fixture)
  ),
  'email_compose',
  'compose suggestion kind is email_compose'
);

select pg_temp.as_user((select member_id from _cec_fixture));

select throws_ok(
  $$
    select public.begin_email_compose_idempotent(
      (select org_id from _cec_fixture),
      'client',
      (select client_id from _cec_fixture),
      encode(extensions.digest('cec-member-idem', 'sha256'), 'hex'),
      encode(extensions.digest('cec-member-req', 'sha256'), 'hex'),
      '/api/v1/clients/compose'
    )
  $$,
  'P0002',
  'Mailbox not found',
  'begin raises when caller has no mailbox'
);

select pg_temp.as_user((select billing_id from _cec_fixture));

select throws_ok(
  $$
    select public.begin_email_compose_idempotent(
      (select org_id from _cec_fixture),
      'client',
      (select client_id from _cec_fixture),
      encode(extensions.digest('cec-billing-idem', 'sha256'), 'hex'),
      encode(extensions.digest('cec-billing-req', 'sha256'), 'hex'),
      '/api/v1/clients/compose'
    )
  $$,
  '42501',
  'Forbidden',
  'billing cannot begin email compose'
);

reset role;

select throws_ok(
  $$
    insert into public.ai_suggestions (
      org_id, kind, entity_type, entity_id, status, variant,
      prompt_version, model_provider, model_name, output_text,
      created_by, updated_by
    )
    select
      org_id, 'not_a_kind', 'client', client_id, 'ready', 'neutral',
      'v1', 'stub', 'stub', 'nope', owner_id, owner_id
    from _cec_fixture
  $$,
  '23514',
  null,
  'ai_suggestions kind rejects unknown values'
);

select * from finish();

rollback;

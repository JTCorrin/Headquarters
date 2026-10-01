begin;

select plan(16);

-- Grants
select ok(
  not has_column_privilege('authenticated', 'public.api_keys', 'key_hash', 'select'),
  'authenticated cannot select api_keys.key_hash'
);

select ok(
  has_column_privilege('authenticated', 'public.api_keys', 'prefix', 'select'),
  'authenticated can still select api_keys.prefix'
);

select ok(
  not has_function_privilege('authenticated', 'private.payment_document(uuid, uuid)', 'execute'),
  'authenticated cannot execute private.payment_document'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.apply_payment_allocations(uuid, uuid, jsonb, uuid)',
    'execute'
  ),
  'authenticated cannot execute private.apply_payment_allocations'
);

select ok(
  not has_function_privilege('anon', 'private.derive_email_domain(text, text)', 'execute'),
  'anon cannot execute private.derive_email_domain'
);

select ok(
  has_function_privilege('authenticated', 'private.derive_email_domain(text, text)', 'execute'),
  'authenticated keeps execute on private.derive_email_domain (invoker trigger path)'
);

select ok(
  not has_table_privilege('authenticated', 'public.tasks', 'truncate')
    and not has_table_privilege('authenticated', 'public.tasks', 'delete'),
  'authenticated cannot truncate or delete tasks'
);

select ok(
  not has_table_privilege('anon', 'public.meetings', 'select'),
  'anon has no privileges on meetings'
);

-- Fixture
create temporary table _osh_fixture (
  owner_id uuid,
  outsider_id uuid,
  org_id uuid,
  owner_membership_id uuid,
  mailbox_id uuid
) on commit drop;

grant all on table _osh_fixture to authenticated;

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
    extensions.crypt('osh-password', extensions.gen_salt('bf')),
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

insert into _osh_fixture (owner_id, outsider_id)
values (
  pg_temp.make_auth_user('osh-owner@example.test', 'OSH Owner'),
  pg_temp.make_auth_user('osh-outsider@example.test', 'OSH Outsider')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency, timezone)
  values (
    'OSH Org',
    'osh-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP',
    'UTC'
  )
  returning id
)
update _osh_fixture set org_id = created_org.id from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _osh_fixture;

update _osh_fixture
set owner_membership_id = (
  select m.id from public.memberships m
  where m.org_id = _osh_fixture.org_id and m.user_id = _osh_fixture.owner_id
);

with created_mailbox as (
  insert into public.mailbox_accounts (
    org_id, membership_id, email_address, from_name,
    imap_host, imap_port, imap_security,
    smtp_host, smtp_port, smtp_security,
    username, status, created_by, updated_by
  )
  select
    org_id, owner_membership_id, 'osh-mail@example.test', 'OSH Mailer',
    'imap.example.test', 993, 'tls',
    'smtp.example.test', 587, 'starttls',
    'osh-mail@example.test', 'active', owner_id, owner_id
  from _osh_fixture
  returning id
)
update _osh_fixture set mailbox_id = created_mailbox.id from created_mailbox;

-- Unscoped credential read is rejected for JWT callers.
select pg_temp.as_user((select outsider_id from _osh_fixture));
set local role authenticated;

select throws_ok(
  $$ select public.read_mailbox_sync_credentials((select mailbox_id from _osh_fixture)) $$,
  '42501',
  'Forbidden',
  'outsider cannot read mailbox credentials without an org scope'
);

reset role;
select pg_temp.as_user((select owner_id from _osh_fixture));
set local role authenticated;

select throws_ok(
  $$ select public.read_mailbox_sync_credentials((select mailbox_id from _osh_fixture), null) $$,
  '42501',
  'Forbidden',
  'even the mailbox owner must pass an org scope'
);

select lives_ok(
  $$
    select public.read_mailbox_sync_credentials(
      (select mailbox_id from _osh_fixture),
      (select org_id from _osh_fixture)
    )
  $$,
  'org-scoped credential read still works for the owning member'
);

select is(
  public.campaign_mailbox_quota_remaining(
    (select org_id from _osh_fixture),
    (select mailbox_id from _osh_fixture)
  ),
  private.email_send_quota_limit(),
  'org member can read campaign mailbox quota'
);

reset role;
select pg_temp.as_user((select outsider_id from _osh_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.campaign_mailbox_quota_remaining(
      (select org_id from _osh_fixture),
      (select mailbox_id from _osh_fixture)
    )
  $$,
  '42501',
  'Forbidden',
  'non-member cannot read campaign mailbox quota'
);

-- No JWT and no service_role claim: rejected.
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);
set local role authenticated;

select throws_ok(
  $$ select public.read_mailbox_sync_credentials((select mailbox_id from _osh_fixture)) $$,
  '42501',
  'Forbidden',
  'unscoped credential read requires service_role'
);

-- Service role keeps the unscoped sync path.
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config(
  'request.jwt.claims',
  json_build_object('role', 'service_role')::text,
  true
);

select is(
  public.read_mailbox_sync_credentials((select mailbox_id from _osh_fixture)) ->> 'email_address',
  'osh-mail@example.test',
  'service_role can read credentials without an org scope'
);

select ok(
  (select 'application/pdf' = any (allowed_mime_types)
      and not ('text/html' = any (allowed_mime_types))
      and not ('image/svg+xml' = any (allowed_mime_types))
   from storage.buckets where id = 'org-documents'),
  'org-documents bucket allows business files but not HTML/SVG'
);

select * from finish();

rollback;

-- Org invoice email accounts + recurring auto-send delivery plumbing.

begin;
select plan(17);

select has_table('public', 'org_invoice_email_accounts', 'org_invoice_email_accounts exists');

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.org_invoice_email_accounts'::regclass
  ),
  'org_invoice_email_accounts has RLS enabled'
);

select ok(
  not has_column_privilege(
    'authenticated',
    'public.org_invoice_email_accounts',
    'secret_ref',
    'select'
  ),
  'authenticated cannot select secret_ref'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.get_org_invoice_email_account(uuid)',
    'execute'
  ),
  'authenticated can get_org_invoice_email_account'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.upsert_org_invoice_email_account(uuid, text, text, text, text, integer, text, text, text, text, text)',
    'execute'
  ),
  'authenticated can upsert_org_invoice_email_account'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.read_org_invoice_email_credentials(uuid)',
    'execute'
  ),
  'authenticated cannot read_org_invoice_email_credentials'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.read_org_invoice_email_credentials(uuid)',
    'execute'
  ),
  'service_role can read_org_invoice_email_credentials'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.claim_recurring_invoice_deliveries(integer, text)',
    'execute'
  ),
  'service_role can claim_recurring_invoice_deliveries'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_recurring_invoice_deliveries(integer, text)',
    'execute'
  ),
  'authenticated cannot claim_recurring_invoice_deliveries'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.complete_recurring_invoice_delivery(uuid, uuid)',
    'execute'
  ),
  'service_role can complete_recurring_invoice_delivery'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.retry_recurring_invoice_delivery(uuid, uuid)',
    'execute'
  ),
  'authenticated can retry_recurring_invoice_delivery'
);

create temporary table _oie_fixture (
  owner_id uuid,
  member_id uuid,
  org_id uuid
) on commit drop;

grant all on table _oie_fixture to authenticated;
grant all on table _oie_fixture to service_role;

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
    extensions.crypt('oie-password', extensions.gen_salt('bf')),
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

insert into _oie_fixture (owner_id, member_id)
values (
  pg_temp.make_auth_user('oie-owner@example.test', 'OIE Owner'),
  pg_temp.make_auth_user('oie-member@example.test', 'OIE Member')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'OIE Org',
    'oie-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
)
update _oie_fixture set org_id = created_org.id from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _oie_fixture;

insert into public.memberships (org_id, user_id, role, status)
select org_id, member_id, 'member', 'active' from _oie_fixture;

-- Member cannot upsert
select pg_temp.as_user((select member_id from _oie_fixture));

select throws_ok(
  $$select public.upsert_org_invoice_email_account(
      (select org_id from _oie_fixture),
      'billing@example.test',
      'Billing',
      null,
      'smtp.example.test',
      465,
      'tls',
      'billing@example.test',
      'secret-password',
      null,
      null
    )$$,
  '42501',
  'Only owners can manage invoice email',
  'member cannot upsert org invoice email'
);

-- Owner upsert
select pg_temp.as_user((select owner_id from _oie_fixture));

select lives_ok(
  $$select public.upsert_org_invoice_email_account(
      (select org_id from _oie_fixture),
      'invoices@example.test',
      'Invoices',
      null,
      'smtp.example.test',
      465,
      'tls',
      'invoices@example.test',
      'secret-password',
      'Invoice {{invoice_number}}',
      'Attached: {{invoice_number}}'
    )$$,
  'owner can upsert org invoice email'
);

select ok(
  (
    select (public.get_org_invoice_email_account(org_id) ->> 'credentials_configured')::boolean
    from _oie_fixture
  ),
  'public json reports credentials_configured'
);

select ok(
  (
    select public.org_invoice_email_is_configured(org_id)
    from _oie_fixture
  ),
  'org_invoice_email_is_configured is true after upsert'
);

-- Disconnect clears credentials
select pg_temp.as_user((select owner_id from _oie_fixture));

select lives_ok(
  $$select public.disconnect_org_invoice_email_account((select org_id from _oie_fixture))$$,
  'owner can disconnect org invoice email'
);

select ok(
  not (
    select public.org_invoice_email_is_configured(org_id)
    from _oie_fixture
  ),
  'org_invoice_email_is_configured is false after disconnect'
);

select * from finish();
rollback;

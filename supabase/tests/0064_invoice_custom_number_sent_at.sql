begin;

select plan(9);

select ok(
  has_function_privilege(
    'authenticated',
    'public.send_invoice(uuid, uuid, integer, timestamptz)',
    'execute'
  ),
  'authenticated users can execute send_invoice with optional sent_at'
);

create temporary table _inv_migrate_fixture (
  owner_id uuid,
  org_id uuid,
  client_id uuid,
  invoice_id uuid,
  invoice_version integer
) on commit drop;

grant all on table _inv_migrate_fixture to authenticated;

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
    extensions.crypt('inv-migrate-password', extensions.gen_salt('bf')),
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

do $$
declare
  owner_id uuid;
  org_id uuid;
  client_id uuid;
begin
  owner_id := pg_temp.make_auth_user('inv-migrate@example.test', 'Invoice Migrate');
  perform pg_temp.as_user(owner_id);
  insert into public.organisations (name, slug, country_code, default_currency)
  values ('Invoice Migrate Org', 'inv-migrate-' || substr(owner_id::text, 1, 8), 'GB', 'GBP')
  returning id into org_id;

  insert into public.clients (org_id, name, status, primary_email)
  values (org_id, 'Migrate Client', 'active', 'client@migrate.test')
  returning id into client_id;

  insert into _inv_migrate_fixture (owner_id, org_id, client_id)
  values (owner_id, org_id, client_id);
end;
$$;

select pg_temp.as_user((select owner_id from _inv_migrate_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.create_invoice_draft(
      (select org_id from _inv_migrate_fixture),
      jsonb_build_object(
        'client_id', (select client_id from _inv_migrate_fixture),
        'number', 'INV-0100',
        'issue_on', '2024-01-15'
      ),
      jsonb_build_array(
        jsonb_build_object(
          'description', 'Legacy line',
          'quantity', 1,
          'unit_price_cents', 1000,
          'tax_rate_percent', 0,
          'position', 0
        )
      )
    )
  $$,
  'owner can create invoice with custom number INV-0100'
);

update _inv_migrate_fixture
set
  invoice_id = invoices.id,
  invoice_version = invoices.version
from public.invoices
where invoices.org_id = _inv_migrate_fixture.org_id
  and invoices.number = 'INV-0100'
  and invoices.deleted_at is null;

select is(
  (select number from public.invoices where id = (select invoice_id from _inv_migrate_fixture)),
  'INV-0100',
  'custom number is stored as provided'
);

select is(
  (
    select next_number
    from public.document_sequences
    where org_id = (select org_id from _inv_migrate_fixture)
      and document_type = 'invoice'
  ),
  101,
  'custom INV-0100 bumps invoice sequence next_number to 101'
);

select throws_ok(
  $$
    select public.create_invoice_draft(
      (select org_id from _inv_migrate_fixture),
      jsonb_build_object(
        'client_id', (select client_id from _inv_migrate_fixture),
        'number', 'INV-0100'
      ),
      '[]'::jsonb
    )
  $$,
  '23505',
  null,
  'duplicate custom invoice number conflicts'
);

select lives_ok(
  $$
    select public.send_invoice(
      (select invoice_id from _inv_migrate_fixture),
      (select org_id from _inv_migrate_fixture),
      (select invoice_version from _inv_migrate_fixture),
      '2024-02-01T10:30:00Z'::timestamptz
    )
  $$,
  'owner can send invoice with explicit sent_at'
);

select is(
  (
    select sent_at = '2024-02-01T10:30:00Z'::timestamptz
      and status = 'sent'
    from public.invoices
    where id = (select invoice_id from _inv_migrate_fixture)
  ),
  true,
  'send_invoice stores overridden sent_at'
);

select lives_ok(
  $$
    select public.create_invoice_draft(
      (select org_id from _inv_migrate_fixture),
      jsonb_build_object(
        'client_id', (select client_id from _inv_migrate_fixture)
      ),
      '[]'::jsonb
    )
  $$,
  'omitting number still auto-allocates after sequence bump'
);

select is(
  (
    select number
    from public.invoices
    where org_id = (select org_id from _inv_migrate_fixture)
      and number = 'INV-0101'
      and deleted_at is null
  ),
  'INV-0101',
  'next auto-allocated invoice is INV-0101'
);

select * from finish();
rollback;

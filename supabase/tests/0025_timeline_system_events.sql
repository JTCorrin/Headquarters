begin;

select plan(16);

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname = 'append_timeline_event'
  ),
  'private.append_timeline_event helper exists'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.append_timeline_event(uuid, text, uuid, text, text, text, uuid, text, uuid, jsonb, timestamptz)',
    'execute'
  ),
  'authenticated cannot call private.append_timeline_event directly'
);

create temporary table _timeline_sys_fixture (
  owner_id uuid,
  org_id uuid,
  client_id uuid,
  contact_id uuid,
  lead_id uuid,
  product_id uuid,
  tax_rate_id uuid,
  quote_id uuid,
  quote_version integer,
  invoice_id uuid,
  invoice_version integer,
  manual_invoice_id uuid,
  manual_invoice_version integer
) on commit drop;

grant all on table _timeline_sys_fixture to authenticated;

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
    extensions.crypt('timeline-sys-password', extensions.gen_salt('bf')),
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
  contact_id uuid;
  lead_id uuid;
  product_id uuid;
  tax_rate_id uuid;
begin
  owner_id := pg_temp.make_auth_user('timeline-sys-owner@example.test', 'Timeline Sys Owner');

  perform pg_temp.as_user(owner_id);
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Timeline Sys Org',
    'timeline-sys-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id into org_id;

  insert into public.memberships (org_id, user_id, role, status)
  values (org_id, owner_id, 'owner', 'active');

  insert into public.document_sequences (org_id, document_type, prefix, next_number, padding)
  values
    (org_id, 'quote', 'Q-', 1, 4),
    (org_id, 'invoice', 'INV-', 1, 4)
  on conflict do nothing;

  insert into public.tax_rates (org_id, name, rate_percent, is_default, active)
  values (org_id, 'VAT 20%', 20, true, true)
  returning id into tax_rate_id;

  insert into public.products (
    org_id, sku, name, product_type, unit_price_cents, currency,
    tax_rate_id, track_stock, status
  )
  values (
    org_id, 'SYS-1', 'System service', 'service', 5000, 'GBP',
    tax_rate_id, false, 'active'
  )
  returning id into product_id;

  insert into public.clients (org_id, name, status, primary_email)
  values (org_id, 'Sys Client', 'active', 'sys@client.test')
  returning id into client_id;

  insert into public.contacts (org_id, display_name, primary_email)
  values (org_id, 'Sys Contact', 'sys@contact.test')
  returning id into contact_id;

  insert into public.leads (
    org_id, name, stage, contact_id, client_id, currency
  )
  values (
    org_id, 'Sys Lead', 'qualified', contact_id, client_id, 'GBP'
  )
  returning id into lead_id;

  insert into _timeline_sys_fixture (
    owner_id, org_id, client_id, contact_id, lead_id, product_id, tax_rate_id
  ) values (
    owner_id, org_id, client_id, contact_id, lead_id, product_id, tax_rate_id
  );
end;
$$;

select pg_temp.as_user((select owner_id from _timeline_sys_fixture));
set local role authenticated;

-- Quote created → quote + client + lead rails
select lives_ok(
  $$
    select public.create_quote_draft(
      (select org_id from _timeline_sys_fixture),
      jsonb_build_object(
        'title', 'System quote',
        'client_id', (select client_id from _timeline_sys_fixture),
        'lead_id', (select lead_id from _timeline_sys_fixture),
        'contact_id', (select contact_id from _timeline_sys_fixture)
      ),
      jsonb_build_array(
        jsonb_build_object(
          'product_id', (select product_id from _timeline_sys_fixture),
          'quantity', 1,
          'position', 0
        )
      )
    )
  $$,
  'create_quote_draft succeeds for timeline writer coverage'
);

update _timeline_sys_fixture
set
  quote_id = quotes.id,
  quote_version = quotes.version
from public.quotes
where quotes.org_id = _timeline_sys_fixture.org_id
  and quotes.title = 'System quote'
  and quotes.deleted_at is null;

select is(
  (
    select count(*)::integer
    from public.timeline_events
    where org_id = (select org_id from _timeline_sys_fixture)
      and kind = 'status'
      and payload->>'action' = 'quote.created'
  ),
  3,
  'quote.created writes quote + client + lead timeline cards'
);

select lives_ok(
  $$
    select public.accept_quote(
      (select quote_id from _timeline_sys_fixture),
      (select org_id from _timeline_sys_fixture),
      (select quote_version from _timeline_sys_fixture)
    )
  $$,
  'accept_quote succeeds for timeline writer coverage'
);

update _timeline_sys_fixture
set quote_version = quotes.version
from public.quotes
where quotes.id = _timeline_sys_fixture.quote_id;

select is(
  (
    select count(*)::integer
    from public.timeline_events
    where org_id = (select org_id from _timeline_sys_fixture)
      and kind = 'status'
      and payload->>'action' = 'quote.accepted'
  ),
  2,
  'quote.accepted writes quote + client timeline cards'
);

select lives_ok(
  $$
    select public.create_invoice_from_quote(
      (select quote_id from _timeline_sys_fixture),
      (select org_id from _timeline_sys_fixture)
    )
  $$,
  'create_invoice_from_quote succeeds for timeline writer coverage'
);

update _timeline_sys_fixture
set
  invoice_id = quotes.converted_invoice_id,
  invoice_version = invoices.version
from public.quotes
join public.invoices on invoices.id = quotes.converted_invoice_id
where quotes.id = _timeline_sys_fixture.quote_id;

select is(
  (
    select count(*)::integer
    from public.timeline_events
    where org_id = (select org_id from _timeline_sys_fixture)
      and kind = 'conversion'
      and payload->>'action' = 'quote.converted_to_invoice'
  ),
  3,
  'quote.converted_to_invoice writes quote + invoice + client cards'
);

-- Idempotent reconvert must not duplicate conversion cards
select lives_ok(
  $$
    select public.create_invoice_from_quote(
      (select quote_id from _timeline_sys_fixture),
      (select org_id from _timeline_sys_fixture)
    )
  $$,
  'create_invoice_from_quote is idempotent'
);

select is(
  (
    select count(*)::integer
    from public.timeline_events
    where org_id = (select org_id from _timeline_sys_fixture)
      and kind = 'conversion'
      and payload->>'action' = 'quote.converted_to_invoice'
  ),
  3,
  'idempotent reconvert does not duplicate conversion timeline cards'
);

-- Manual invoice create / send / void
select lives_ok(
  $$
    select public.create_invoice_draft(
      (select org_id from _timeline_sys_fixture),
      jsonb_build_object(
        'client_id', (select client_id from _timeline_sys_fixture),
        'contact_id', (select contact_id from _timeline_sys_fixture)
      ),
      jsonb_build_array(
        jsonb_build_object(
          'product_id', (select product_id from _timeline_sys_fixture),
          'quantity', 2,
          'position', 0
        )
      )
    )
  $$,
  'create_invoice_draft succeeds for timeline writer coverage'
);

update _timeline_sys_fixture
set
  manual_invoice_id = latest.id,
  manual_invoice_version = latest.version
from (
  select id, version
  from public.invoices
  where org_id = (select org_id from _timeline_sys_fixture)
    and source = 'manual'
    and deleted_at is null
  order by created_at desc
  limit 1
) latest;

select is(
  (
    select count(*)::integer
    from public.timeline_events
    where org_id = (select org_id from _timeline_sys_fixture)
      and kind = 'status'
      and payload->>'action' = 'invoice.created'
      and (payload->>'invoice_id')::uuid = (select manual_invoice_id from _timeline_sys_fixture)
  ),
  2,
  'invoice.created writes invoice + client timeline cards'
);

select lives_ok(
  $$
    select public.send_invoice(
      (select manual_invoice_id from _timeline_sys_fixture),
      (select org_id from _timeline_sys_fixture),
      (select manual_invoice_version from _timeline_sys_fixture)
    )
  $$,
  'send_invoice succeeds for timeline writer coverage'
);

update _timeline_sys_fixture
set manual_invoice_version = invoices.version
from public.invoices
where invoices.id = _timeline_sys_fixture.manual_invoice_id;

select is(
  (
    select count(*)::integer
    from public.timeline_events
    where org_id = (select org_id from _timeline_sys_fixture)
      and kind = 'status'
      and payload->>'action' = 'invoice.sent'
      and (payload->>'invoice_id')::uuid = (select manual_invoice_id from _timeline_sys_fixture)
  ),
  2,
  'invoice.sent writes invoice + client timeline cards'
);

select lives_ok(
  $$
    select public.void_invoice(
      (select manual_invoice_id from _timeline_sys_fixture),
      (select org_id from _timeline_sys_fixture),
      (select manual_invoice_version from _timeline_sys_fixture),
      'Customer cancelled'
    )
  $$,
  'void_invoice succeeds for timeline writer coverage'
);

select is(
  (
    select count(*)::integer
    from public.timeline_events
    where org_id = (select org_id from _timeline_sys_fixture)
      and kind = 'status'
      and payload->>'action' = 'invoice.voided'
      and (payload->>'invoice_id')::uuid = (select manual_invoice_id from _timeline_sys_fixture)
      and payload->>'void_reason' = 'Customer cancelled'
  ),
  2,
  'invoice.voided writes invoice + client timeline cards with reason'
);

select * from finish();
rollback;

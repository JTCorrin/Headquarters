begin;

select plan(8);

create temporary table _mcr_fix_fixture (
  owner_id uuid,
  org_id uuid,
  client_id uuid,
  contact_a uuid,
  contact_b uuid,
  quote_id uuid,
  invoice_id uuid,
  accept_body jsonb,
  send_body jsonb,
  reject_doc jsonb
) on commit drop;

grant all on table _mcr_fix_fixture to authenticated;

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
    extensions.crypt('mcr-fix-password', extensions.gen_salt('bf')),
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

insert into _mcr_fix_fixture (owner_id)
values (pg_temp.make_auth_user('mcr-fix-owner@example.test', 'MCR Fix Owner'));

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency, timezone)
  values (
    'MCR Fix Org',
    'mcrfix-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP',
    'UTC'
  )
  returning id
)
update _mcr_fix_fixture set org_id = created_org.id from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _mcr_fix_fixture;

with created_client as (
  insert into public.clients (org_id, name, status, created_by, updated_by)
  select org_id, 'MCR Fix Client', 'active', owner_id, owner_id from _mcr_fix_fixture
  returning id
)
update _mcr_fix_fixture set client_id = created_client.id from created_client;

with created_a as (
  insert into public.contacts (
    org_id, display_name, primary_email, lifecycle_status, created_by, updated_by
  )
  select org_id, 'Ada Fix', 'ada-fix@example.test', 'active', owner_id, owner_id
  from _mcr_fix_fixture
  returning id
)
update _mcr_fix_fixture set contact_a = created_a.id from created_a;

with created_b as (
  insert into public.contacts (
    org_id, display_name, primary_email, lifecycle_status, created_by, updated_by
  )
  select org_id, 'Bob Fix', 'bob-fix@example.test', 'active', owner_id, owner_id
  from _mcr_fix_fixture
  returning id
)
update _mcr_fix_fixture set contact_b = created_b.id from created_b;

select pg_temp.as_user((select owner_id from _mcr_fix_fixture));

-- Envelope unit: recipients survive flatten for quote/invoice
select is(
  private.financial_document_envelope(
    jsonb_build_object(
      'quote', jsonb_build_object('id', gen_random_uuid(), 'version', 2),
      'lines', '[]'::jsonb,
      'recipients', jsonb_build_array(jsonb_build_object('contact_id', gen_random_uuid()))
    ),
    'quote'
  ) -> 'body' -> 'data' -> 'recipients' -> 0 ? 'contact_id',
  true,
  'financial_document_envelope preserves quote recipients'
);

select is(
  jsonb_array_length(
    private.financial_document_envelope(
      jsonb_build_object(
        'invoice', jsonb_build_object('id', gen_random_uuid(), 'version', 1),
        'lines', '[]'::jsonb
      ),
      'invoice'
    ) -> 'body' -> 'data' -> 'recipients'
  ),
  0,
  'financial_document_envelope defaults invoice recipients to []'
);

with created as (
  select public.create_quote_draft(
    (select org_id from _mcr_fix_fixture),
    jsonb_build_object(
      'title', 'MCR Fix Quote',
      'client_id', (select client_id from _mcr_fix_fixture),
      'currency', 'GBP',
      'recipients', jsonb_build_array(
        jsonb_build_object(
          'contact_id', (select contact_a from _mcr_fix_fixture),
          'is_billing', true
        ),
        jsonb_build_object(
          'contact_id', (select contact_b from _mcr_fix_fixture),
          'is_billing', false
        )
      )
    ),
    '[]'::jsonb
  ) as doc
)
update _mcr_fix_fixture
set quote_id = (doc -> 'quote' ->> 'id')::uuid
from created;

-- accept_quote allows draft|sent — exercise idempotent envelope from draft
with accepted as (
  select public.accept_quote_idempotent(
    (select quote_id from _mcr_fix_fixture),
    (select org_id from _mcr_fix_fixture),
    (select version from public.quotes where id = (select quote_id from _mcr_fix_fixture)),
    repeat('1', 64),
    repeat('2', 64),
    '/api/v1/quotes/' || (select quote_id::text from _mcr_fix_fixture) || '/accept'
  ) as body
)
update _mcr_fix_fixture set accept_body = accepted.body from accepted;

select is(
  (select accept_body ->> 'replay' from _mcr_fix_fixture),
  'false',
  'accept_quote_idempotent stores non-replay response'
);

select is(
  jsonb_array_length(
    (select accept_body -> 'response_body' -> 'data' -> 'recipients' from _mcr_fix_fixture)
  ),
  2,
  'accept_quote_idempotent response_body includes recipients[]'
);

-- Strip contacts[] to simulate pre-migration singular freeze, then convert
select set_config('app.allow_quote_lifecycle', 'on', true);
select set_config('app.allow_quote_totals', 'on', true);
update public.quotes
set party_snapshot = party_snapshot - 'contacts'
where id = (select quote_id from _mcr_fix_fixture);
select set_config('app.allow_quote_lifecycle', 'off', true);
select set_config('app.allow_quote_totals', 'off', true);

with converted as (
  select public.create_invoice_from_quote(
    (select quote_id from _mcr_fix_fixture),
    (select org_id from _mcr_fix_fixture)
  ) as doc
)
update _mcr_fix_fixture
set invoice_id = (doc -> 'invoice' ->> 'id')::uuid
from converted;

select ok(
  (
    select party_snapshot ? 'contacts'
      and jsonb_array_length(party_snapshot -> 'contacts') = 2
    from public.invoices
    where id = (select invoice_id from _mcr_fix_fixture)
  ),
  'convert rebuilds party_snapshot.contacts[] when missing on quote'
);

with sent as (
  select public.send_invoice_idempotent(
    (select invoice_id from _mcr_fix_fixture),
    (select org_id from _mcr_fix_fixture),
    (select version from public.invoices where id = (select invoice_id from _mcr_fix_fixture)),
    repeat('3', 64),
    repeat('4', 64),
    '/api/v1/invoices/' || (select invoice_id::text from _mcr_fix_fixture) || '/send'
  ) as body
)
update _mcr_fix_fixture set send_body = sent.body from sent;

select is(
  jsonb_array_length(
    (select send_body -> 'response_body' -> 'data' -> 'recipients' from _mcr_fix_fixture)
  ),
  2,
  'send_invoice_idempotent response_body includes recipients[]'
);

-- Fresh quote for reject_quote recipients shape
with created as (
  select public.create_quote_draft(
    (select org_id from _mcr_fix_fixture),
    jsonb_build_object(
      'title', 'MCR Reject Quote',
      'client_id', (select client_id from _mcr_fix_fixture),
      'currency', 'GBP',
      'recipients', jsonb_build_array(
        jsonb_build_object(
          'contact_id', (select contact_a from _mcr_fix_fixture),
          'is_billing', true
        )
      )
    ),
    '[]'::jsonb
  ) as doc
)
update _mcr_fix_fixture
set quote_id = (doc -> 'quote' ->> 'id')::uuid
from created;

with rejected as (
  select public.reject_quote(
    (select quote_id from _mcr_fix_fixture),
    (select org_id from _mcr_fix_fixture),
    (select version from public.quotes where id = (select quote_id from _mcr_fix_fixture))
  ) as doc
)
update _mcr_fix_fixture set reject_doc = rejected.doc from rejected;

select is(
  jsonb_array_length((select reject_doc -> 'recipients' from _mcr_fix_fixture)),
  1,
  'reject_quote returns recipients[]'
);

select * from finish();
rollback;

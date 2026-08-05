begin;

select plan(17);

select has_table('public', 'quote_recipients', 'quote_recipients table exists');
select has_table('public', 'invoice_recipients', 'invoice_recipients table exists');
select has_table(
  'public',
  'recurring_invoice_schedule_recipients',
  'recurring schedule recipients table exists'
);

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.quote_recipients'::regclass
  ),
  'quote_recipients have RLS enabled'
);

create temporary table _mcr_fixture (
  owner_id uuid,
  org_id uuid,
  client_id uuid,
  contact_a uuid,
  contact_b uuid,
  quote_id uuid,
  quote_version integer,
  invoice_id uuid
) on commit drop;

grant all on table _mcr_fixture to authenticated;

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
    extensions.crypt('mcr-password', extensions.gen_salt('bf')),
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

insert into _mcr_fixture (owner_id)
values (pg_temp.make_auth_user('mcr-owner@example.test', 'MCR Owner'));

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency, timezone)
  values (
    'MCR Org',
    'mcr-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP',
    'UTC'
  )
  returning id
)
update _mcr_fixture set org_id = created_org.id from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _mcr_fixture;

with created_client as (
  insert into public.clients (org_id, name, status, created_by, updated_by)
  select org_id, 'MCR Client', 'active', owner_id, owner_id from _mcr_fixture
  returning id
)
update _mcr_fixture set client_id = created_client.id from created_client;

with created_a as (
  insert into public.contacts (
    org_id, display_name, primary_email, lifecycle_status, created_by, updated_by
  )
  select org_id, 'Ada Billing', 'ada-mcr@example.test', 'active', owner_id, owner_id
  from _mcr_fixture
  returning id
)
update _mcr_fixture set contact_a = created_a.id from created_a;

with created_b as (
  insert into public.contacts (
    org_id, display_name, primary_email, lifecycle_status, created_by, updated_by
  )
  select org_id, 'Bob Other', 'bob-mcr@example.test', 'active', owner_id, owner_id
  from _mcr_fixture
  returning id
)
update _mcr_fixture set contact_b = created_b.id from created_b;

select pg_temp.as_user((select owner_id from _mcr_fixture));

with created as (
  select public.create_quote_draft(
    (select org_id from _mcr_fixture),
    jsonb_build_object(
      'title', 'MCR Quote',
      'client_id', (select client_id from _mcr_fixture),
      'currency', 'GBP',
      'recipients', jsonb_build_array(
        jsonb_build_object(
          'contact_id', (select contact_a from _mcr_fixture),
          'is_billing', true
        ),
        jsonb_build_object(
          'contact_id', (select contact_b from _mcr_fixture),
          'is_billing', false
        )
      )
    ),
    '[]'::jsonb
  ) as doc
)
update _mcr_fixture
set
  quote_id = (doc -> 'quote' ->> 'id')::uuid,
  quote_version = (doc -> 'quote' ->> 'version')::integer
from created;

select isnt(
  (select quote_id from _mcr_fixture),
  null::uuid,
  'create_quote_draft accepts recipients[]'
);

select is(
  (
    select contact_id
    from public.quotes
    where id = (select quote_id from _mcr_fixture)
  ),
  (select contact_a from _mcr_fixture),
  'quote.contact_id denorms to is_billing recipient'
);

select is(
  (
    select count(*)::integer
    from public.quote_recipients
    where quote_id = (select quote_id from _mcr_fixture)
  ),
  2,
  'quote has two recipient rows'
);

select is(
  (
    select jsonb_array_length(doc -> 'recipients')
    from (
      select public.get_quote_document(
        (select quote_id from _mcr_fixture),
        (select org_id from _mcr_fixture)
      ) as doc
    ) q
  ),
  2,
  'get_quote_document returns recipients[]'
);

select throws_ok(
  format(
    $fmt$
      select public.save_quote_draft(
        %L::uuid,
        %L::uuid,
        %s,
        %L::jsonb,
        null
      )
    $fmt$,
    (select quote_id from _mcr_fixture),
    (select org_id from _mcr_fixture),
    (select version from public.quotes where id = (select quote_id from _mcr_fixture)),
    jsonb_build_object(
      'recipients', jsonb_build_array(
        jsonb_build_object(
          'contact_id', (select contact_a from _mcr_fixture),
          'is_billing', true
        ),
        jsonb_build_object(
          'contact_id', (select contact_a from _mcr_fixture),
          'is_billing', false
        )
      )
    )
  ),
  '22023',
  'Recipient contact_id is duplicated',
  'duplicate recipients rejected'
);

select lives_ok(
  format(
    $fmt$
      select public.send_quote(%L::uuid, %L::uuid, %s)
    $fmt$,
    (select quote_id from _mcr_fixture),
    (select org_id from _mcr_fixture),
    (select version from public.quotes where id = (select quote_id from _mcr_fixture))
  ),
  'send_quote succeeds with multi recipients'
);

select ok(
  (
    select jsonb_array_length(party_snapshot -> 'contacts') = 2
      and party_snapshot -> 'contact' ->> 'display_name' = 'Ada Billing'
    from public.quotes
    where id = (select quote_id from _mcr_fixture)
  ),
  'send_quote freezes party_snapshot.contacts[] and billing contact'
);

select lives_ok(
  format(
    $fmt$
      select public.accept_quote(%L::uuid, %L::uuid, %s)
    $fmt$,
    (select quote_id from _mcr_fixture),
    (select org_id from _mcr_fixture),
    (select version from public.quotes where id = (select quote_id from _mcr_fixture))
  ),
  'accept_quote succeeds'
);

with created as (
  select public.create_invoice_from_quote(
    (select quote_id from _mcr_fixture),
    (select org_id from _mcr_fixture)
  ) as doc
)
update _mcr_fixture
set invoice_id = (doc -> 'invoice' ->> 'id')::uuid
from created;

select isnt(
  (select invoice_id from _mcr_fixture),
  null::uuid,
  'create_invoice_from_quote copies recipients'
);

select is(
  (
    select count(*)::integer
    from public.invoice_recipients
    where invoice_id = (select invoice_id from _mcr_fixture)
  ),
  2,
  'converted invoice has two recipient rows'
);

select is(
  (
    select contact_id
    from public.invoices
    where id = (select invoice_id from _mcr_fixture)
  ),
  (select contact_a from _mcr_fixture),
  'converted invoice.contact_id matches billing recipient'
);

select lives_ok(
  format(
    $fmt$
      select public.create_invoice_draft(
        %L::uuid,
        %L::jsonb,
        %L::jsonb
      )
    $fmt$,
    (select org_id from _mcr_fixture),
    jsonb_build_object(
      'client_id', (select client_id from _mcr_fixture),
      'currency', 'GBP',
      'recipients', '[]'::jsonb
    ),
    jsonb_build_array(
      jsonb_build_object(
        'description', 'Line',
        'quantity', 1,
        'unit_price_cents', 1000,
        'tax_rate_percent', 0
      )
    )
  ),
  'create_invoice_draft allows empty recipients'
);

select throws_ok(
  format(
    $fmt$
      select public.create_quote_draft(
        %L::uuid,
        %L::jsonb,
        '[]'::jsonb
      )
    $fmt$,
    (select org_id from _mcr_fixture),
    jsonb_build_object(
      'title', 'Bad billing flags',
      'client_id', (select client_id from _mcr_fixture),
      'currency', 'GBP',
      'recipients', jsonb_build_array(
        jsonb_build_object(
          'contact_id', (select contact_a from _mcr_fixture),
          'is_billing', true
        ),
        jsonb_build_object(
          'contact_id', (select contact_b from _mcr_fixture),
          'is_billing', true
        )
      )
    )
  ),
  '22023',
  'Exactly one recipient must be marked is_billing when recipients are set',
  'multiple is_billing rejected'
);

select * from finish();
rollback;

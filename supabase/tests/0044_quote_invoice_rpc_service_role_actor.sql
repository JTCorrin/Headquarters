begin;

select plan(9);

select ok(
  has_function_privilege(
    'service_role',
    'public.create_quote_draft(uuid, jsonb, jsonb, uuid)',
    'execute'
  ),
  'service_role can execute create_quote_draft'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.save_quote_draft(uuid, uuid, integer, jsonb, jsonb, uuid)',
    'execute'
  ),
  'service_role can execute save_quote_draft'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.get_quote_document(uuid, uuid, uuid)',
    'execute'
  ),
  'service_role can execute get_quote_document'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.create_invoice_draft(uuid, jsonb, jsonb, uuid)',
    'execute'
  ),
  'service_role can execute create_invoice_draft'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.save_invoice_draft(uuid, uuid, integer, jsonb, jsonb, uuid)',
    'execute'
  ),
  'service_role can execute save_invoice_draft'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.get_invoice_document(uuid, uuid, uuid)',
    'execute'
  ),
  'service_role can execute get_invoice_document'
);

create temporary table _wave_c_actor_fixture (
  owner_id uuid,
  org_id uuid,
  client_id uuid
) on commit drop;

grant all on table _wave_c_actor_fixture to authenticated;
grant all on table _wave_c_actor_fixture to service_role;

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
    extensions.crypt('wave-c-actor-password', extensions.gen_salt('bf')),
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
  owner_id := pg_temp.make_auth_user('wave-c-actor@example.test', 'Wave C Actor');

  perform pg_temp.as_user(owner_id);
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Wave C Actor Org',
    'wave-c-actor-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id into org_id;

  insert into public.memberships (org_id, user_id, role, status)
  values (org_id, owner_id, 'owner', 'active');

  insert into public.clients (org_id, name, status, created_by, updated_by)
  values (org_id, 'Wave C Client', 'active', owner_id, owner_id)
  returning id into client_id;

  insert into _wave_c_actor_fixture (owner_id, org_id, client_id)
  values (owner_id, org_id, client_id);
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config(
  'request.jwt.claims',
  json_build_object('role', 'service_role')::text,
  true
);

select throws_ok(
  $$
    select public.create_quote_draft(
      (select org_id from _wave_c_actor_fixture),
      jsonb_build_object(
        'title', 'No Actor Quote',
        'client_id', (select client_id from _wave_c_actor_fixture),
        'currency', 'GBP'
      ),
      '[]'::jsonb,
      null
    )
  $$,
  '42501',
  'Authentication is required',
  'service_role create_quote without p_actor_id is rejected'
);

select is(
  (
    select (public.create_quote_draft(
      (select org_id from _wave_c_actor_fixture),
      jsonb_build_object(
        'title', 'API Key Quote',
        'client_id', (select client_id from _wave_c_actor_fixture),
        'currency', 'GBP'
      ),
      '[{"description":"Line","quantity":1,"unit_price_cents":1000,"discount_percent":0,"tax_rate_percent":0}]'::jsonb,
      (select owner_id from _wave_c_actor_fixture)
    ) -> 'quote' ->> 'created_by')
  ),
  (select owner_id::text from _wave_c_actor_fixture),
  'service_role create_quote stores created_by from p_actor_id'
);

select is(
  (
    select (public.create_invoice_draft(
      (select org_id from _wave_c_actor_fixture),
      jsonb_build_object(
        'client_id', (select client_id from _wave_c_actor_fixture),
        'currency', 'GBP'
      ),
      '[{"description":"Line","quantity":1,"unit_price_cents":2000,"discount_percent":0,"tax_rate_percent":0}]'::jsonb,
      (select owner_id from _wave_c_actor_fixture)
    ) -> 'invoice' ->> 'created_by')
  ),
  (select owner_id::text from _wave_c_actor_fixture),
  'service_role create_invoice stores created_by from p_actor_id'
);

select * from finish();
rollback;

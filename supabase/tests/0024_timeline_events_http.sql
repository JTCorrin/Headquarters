begin;

select plan(11);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.timeline_events'::regclass
      and conname = 'timeline_events_entity_type_check'
      and pg_get_constraintdef(oid) like '%quote%'
      and pg_get_constraintdef(oid) like '%invoice%'
      and pg_get_constraintdef(oid) like '%bill%'
  ),
  'timeline_events entity_type allows quote, invoice, bill'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_timeline_event(uuid, text, uuid, text, text, text, jsonb)',
    'execute'
  ),
  'authenticated users can execute create_timeline_event'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.create_timeline_event(uuid, text, uuid, text, text, text, jsonb)',
    'execute'
  ),
  'anonymous users cannot execute create_timeline_event'
);

select ok(
  not exists (
    select 1
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'timeline_events'
      and grantee = 'authenticated'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ),
  'authenticated users still cannot mutate timeline_events directly'
);

create temporary table _timeline_http_fixture (
  owner_id uuid,
  billing_id uuid,
  outsider_id uuid,
  org_id uuid,
  other_org_id uuid,
  contact_id uuid,
  note_id uuid
) on commit drop;

grant all on table _timeline_http_fixture to authenticated;

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
    extensions.crypt('timeline-http-password', extensions.gen_salt('bf')),
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
  billing_id uuid;
  outsider_id uuid;
  org_id uuid;
  other_org_id uuid;
  contact_id uuid;
begin
  owner_id := pg_temp.make_auth_user('timeline-owner@example.test', 'Timeline Owner');
  billing_id := pg_temp.make_auth_user('timeline-billing@example.test', 'Timeline Billing');
  outsider_id := pg_temp.make_auth_user('timeline-outsider@example.test', 'Timeline Outsider');

  perform pg_temp.as_user(owner_id);
  insert into public.organisations (name, slug, country_code, default_currency)
  values ('Timeline Org', 'timeline-http-org', 'GB', 'GBP')
  returning id into org_id;

  insert into public.memberships (org_id, user_id, role, status)
  values
    (org_id, owner_id, 'owner', 'active'),
    (org_id, billing_id, 'billing', 'active');

  perform pg_temp.as_user(outsider_id);
  insert into public.organisations (name, slug, country_code, default_currency)
  values ('Other Timeline Org', 'timeline-http-other', 'GB', 'GBP')
  returning id into other_org_id;

  perform pg_temp.as_user(owner_id);
  insert into public.contacts (org_id, display_name)
  values (org_id, 'Timeline Contact')
  returning id into contact_id;

  insert into _timeline_http_fixture (
    owner_id, billing_id, outsider_id, org_id, other_org_id, contact_id
  ) values (
    owner_id, billing_id, outsider_id, org_id, other_org_id, contact_id
  );
end;
$$;

select pg_temp.as_user((select owner_id from _timeline_http_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.create_timeline_event(
      (select org_id from _timeline_http_fixture),
      'contact',
      (select contact_id from _timeline_http_fixture),
      'note',
      'Hello timeline',
      'Body text',
      '{"accent":"slate","icon":"note"}'::jsonb
    )
  $$,
  'owner can create a timeline note on a contact'
);

update _timeline_http_fixture
set note_id = (
  select id from public.timeline_events
  where org_id = (select org_id from _timeline_http_fixture)
    and entity_id = (select contact_id from _timeline_http_fixture)
    and kind = 'note'
  order by created_at desc
  limit 1
);

select ok(
  (select note_id is not null from _timeline_http_fixture),
  'created note is persisted'
);

select results_eq(
  $$
    select title, body, actor_type, (payload->>'accent')
    from public.timeline_events
    where id = (select note_id from _timeline_http_fixture)
  $$,
  $$
    values ('Hello timeline', 'Body text', 'user', 'slate')
  $$,
  'note stores title, body, actor, and payload accent'
);

select throws_ok(
  $$
    select public.create_timeline_event(
      (select org_id from _timeline_http_fixture),
      'contact',
      (select contact_id from _timeline_http_fixture),
      'conversion',
      'Should fail',
      null,
      '{}'::jsonb
    )
  $$,
  '22023',
  null,
  'create_timeline_event rejects conversion kind'
);

reset role;
select pg_temp.as_user((select billing_id from _timeline_http_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.create_timeline_event(
      (select org_id from _timeline_http_fixture),
      'contact',
      (select contact_id from _timeline_http_fixture),
      'note',
      'Billing note',
      null,
      '{}'::jsonb
    )
  $$,
  '42501',
  null,
  'billing cannot create timeline notes'
);

reset role;
select pg_temp.as_user((select outsider_id from _timeline_http_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.create_timeline_event(
      (select org_id from _timeline_http_fixture),
      'contact',
      (select contact_id from _timeline_http_fixture),
      'note',
      'Outsider note',
      null,
      '{}'::jsonb
    )
  $$,
  '42501',
  null,
  'outsider cannot create timeline notes in another org'
);

reset role;
select pg_temp.as_user((select owner_id from _timeline_http_fixture));
set local role authenticated;

select isnt_empty(
  $$
    select id from public.timeline_events
    where org_id = (select org_id from _timeline_http_fixture)
      and entity_type = 'contact'
      and entity_id = (select contact_id from _timeline_http_fixture)
  $$,
  'member select can list contact timeline events'
);

select * from finish();
rollback;

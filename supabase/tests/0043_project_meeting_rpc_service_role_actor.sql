begin;

select plan(5);

select ok(
  has_function_privilege(
    'service_role',
    'public.create_project_with_defaults(uuid, jsonb, uuid)',
    'execute'
  ),
  'service_role can execute create_project_with_defaults'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.replace_meeting_attendees(uuid, uuid, jsonb, uuid)',
    'execute'
  ),
  'service_role can execute replace_meeting_attendees'
);

create temporary table _wave_b_actor_fixture (
  owner_id uuid,
  org_id uuid,
  client_id uuid,
  meeting_id uuid
) on commit drop;

grant all on table _wave_b_actor_fixture to authenticated;
grant all on table _wave_b_actor_fixture to service_role;

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
    extensions.crypt('wave-b-actor-password', extensions.gen_salt('bf')),
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
  meeting_id uuid;
begin
  owner_id := pg_temp.make_auth_user('wave-b-actor@example.test', 'Wave B Actor');

  perform pg_temp.as_user(owner_id);
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Wave B Actor Org',
    'wave-b-actor-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id into org_id;

  insert into public.memberships (org_id, user_id, role, status)
  values (org_id, owner_id, 'owner', 'active');

  insert into public.clients (org_id, name, status, created_by, updated_by)
  values (org_id, 'Wave B Client', 'active', owner_id, owner_id)
  returning id into client_id;

  insert into public.meetings (
    org_id, title, status, starts_at, ends_at, timezone, created_by, updated_by
  )
  values (
    org_id,
    'Wave B Meeting',
    'scheduled',
    now() + interval '1 hour',
    now() + interval '2 hours',
    'UTC',
    owner_id,
    owner_id
  )
  returning id into meeting_id;

  insert into _wave_b_actor_fixture (owner_id, org_id, client_id, meeting_id)
  values (owner_id, org_id, client_id, meeting_id);
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
    select public.create_project_with_defaults(
      (select org_id from _wave_b_actor_fixture),
      jsonb_build_object(
        'client_id', (select client_id from _wave_b_actor_fixture),
        'name', 'No Actor Project'
      ),
      null
    )
  $$,
  '42501',
  'Authentication is required',
  'service_role create_project without p_actor_id is rejected'
);

select is(
  (
    select (public.create_project_with_defaults(
      (select org_id from _wave_b_actor_fixture),
      jsonb_build_object(
        'client_id', (select client_id from _wave_b_actor_fixture),
        'name', 'API Key Project'
      ),
      (select owner_id from _wave_b_actor_fixture)
    ) ->> 'created_by')
  ),
  (select owner_id::text from _wave_b_actor_fixture),
  'service_role create_project stores created_by from p_actor_id'
);

select ok(
  jsonb_array_length(
    public.replace_meeting_attendees(
      (select meeting_id from _wave_b_actor_fixture),
      (select org_id from _wave_b_actor_fixture),
      '[{"email":"ada@example.test","name":"Ada","organiser":true}]'::jsonb,
      (select owner_id from _wave_b_actor_fixture)
    )
  ) = 1,
  'service_role replace_meeting_attendees works with p_actor_id'
);

select * from finish();
rollback;

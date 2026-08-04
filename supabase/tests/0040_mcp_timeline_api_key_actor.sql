begin;

select plan(8);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.timeline_events'::regclass
      and conname = 'timeline_events_actor_type_check'
      and pg_get_constraintdef(oid) like '%api_key%'
  ),
  'timeline_events actor_type allows api_key'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.create_timeline_event(uuid, text, uuid, text, text, text, jsonb, text, uuid)',
    'execute'
  ),
  'service_role can execute create_timeline_event'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.append_audit_event_for_api_key(uuid, uuid, text, text, uuid, uuid, jsonb, jsonb)',
    'execute'
  ),
  'service_role can execute append_audit_event_for_api_key'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.append_audit_event_for_api_key(uuid, uuid, text, text, uuid, uuid, jsonb, jsonb)',
    'execute'
  ),
  'authenticated cannot execute append_audit_event_for_api_key'
);

create temporary table _mcp_actor_fixture (
  owner_id uuid,
  org_id uuid,
  contact_id uuid,
  key_id uuid,
  secret text
) on commit drop;

grant all on table _mcp_actor_fixture to authenticated;
grant all on table _mcp_actor_fixture to service_role;

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
    extensions.crypt('mcp-actor-password', extensions.gen_salt('bf')),
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
  contact_id uuid;
  created jsonb;
begin
  owner_id := pg_temp.make_auth_user('mcp-actor-owner@example.test', 'MCP Actor Owner');

  perform pg_temp.as_user(owner_id);
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'MCP Actor Org',
    'mcp-actor-org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id into org_id;

  insert into public.memberships (org_id, user_id, role, status)
  values (org_id, owner_id, 'owner', 'active');

  insert into public.contacts (org_id, display_name)
  values (org_id, 'MCP Actor Contact')
  returning id into contact_id;

  created := public.create_org_api_key(org_id, 'MCP Actor Key', 'member', null);

  insert into _mcp_actor_fixture (owner_id, org_id, contact_id, key_id, secret)
  values (
    owner_id,
    org_id,
    contact_id,
    (created->>'id')::uuid,
    created->>'secret'
  );
end;
$$;

select pg_temp.as_user((select owner_id from _mcp_actor_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.create_timeline_event(
      (select org_id from _mcp_actor_fixture),
      'contact',
      (select contact_id from _mcp_actor_fixture),
      'note',
      'JWT note',
      'body',
      '{}'::jsonb
    )
  $$,
  'JWT create_timeline_event still works without actor args'
);

select throws_ok(
  $$
    select public.create_timeline_event(
      (select org_id from _mcp_actor_fixture),
      'contact',
      (select contact_id from _mcp_actor_fixture),
      'note',
      'Bad key note',
      null,
      '{}'::jsonb,
      'api_key',
      (select key_id from _mcp_actor_fixture)
    )
  $$,
  '42501',
  'Forbidden',
  'authenticated cannot create timeline as api_key'
);

-- auth.role() reads JWT claims; service_role path is claim-gated (not SET ROLE).
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config(
  'request.jwt.claims',
  json_build_object('role', 'service_role')::text,
  true
);

select is(
  (
    select actor_type::text
    from public.create_timeline_event(
      (select org_id from _mcp_actor_fixture),
      'contact',
      (select contact_id from _mcp_actor_fixture),
      'note',
      'API key note',
      'from mcp',
      '{}'::jsonb,
      'api_key',
      (select key_id from _mcp_actor_fixture)
    )
  ),
  'api_key',
  'service_role create_timeline_event stores actor_type=api_key'
);

select ok(
  public.append_audit_event_for_api_key(
    (select org_id from _mcp_actor_fixture),
    (select key_id from _mcp_actor_fixture),
    'task.created',
    'task',
    gen_random_uuid(),
    null,
    '{"title":"x"}'::jsonb,
    '{"source":"test"}'::jsonb
  ) is not null,
  'append_audit_event_for_api_key writes an audit row'
);

select * from finish();
rollback;

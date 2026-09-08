begin;

select plan(8);

select ok(
  has_function_privilege(
    'service_role',
    'public.list_entity_tags(uuid, text, uuid, uuid)',
    'execute'
  ),
  'service_role can execute list_entity_tags'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.replace_entity_tags(uuid, text, uuid, uuid[], uuid)',
    'execute'
  ),
  'service_role can execute replace_entity_tags'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.soft_delete_tag(uuid, uuid, integer, uuid)',
    'execute'
  ),
  'service_role can execute soft_delete_tag'
);

create temporary table _tag_actor_fixture (
  owner_id uuid,
  org_id uuid,
  tag_id uuid,
  lead_id uuid,
  contact_id uuid,
  client_id uuid
) on commit drop;

grant all on table _tag_actor_fixture to authenticated;
grant all on table _tag_actor_fixture to service_role;

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
    extensions.crypt('tag-actor-password', extensions.gen_salt('bf')),
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
  tag_id uuid;
  lead_id uuid;
  contact_id uuid;
  client_id uuid;
begin
  owner_id := pg_temp.make_auth_user('tag-actor@example.test', 'Tag Actor');

  perform pg_temp.as_user(owner_id);
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Tag Actor Org',
    'tag-actor-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id into org_id;

  insert into public.memberships (org_id, user_id, role, status)
  values (org_id, owner_id, 'owner', 'active');

  insert into public.tags (org_id, name, created_by, updated_by)
  values (org_id, 'MCP Audience', owner_id, owner_id)
  returning id into tag_id;

  insert into public.leads (org_id, name, stage, created_by, updated_by)
  values (org_id, 'Tagged Lead', 'new', owner_id, owner_id)
  returning id into lead_id;

  insert into public.contacts (
    org_id, display_name, lifecycle_status, created_by, updated_by
  )
  values (org_id, 'Tagged Contact', 'active', owner_id, owner_id)
  returning id into contact_id;

  insert into public.clients (org_id, name, status, created_by, updated_by)
  values (org_id, 'Tagged Client', 'active', owner_id, owner_id)
  returning id into client_id;

  insert into _tag_actor_fixture (owner_id, org_id, tag_id, lead_id, contact_id, client_id)
  values (owner_id, org_id, tag_id, lead_id, contact_id, client_id);
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
    select public.replace_entity_tags(
      (select org_id from _tag_actor_fixture),
      'lead',
      (select lead_id from _tag_actor_fixture),
      array[(select tag_id from _tag_actor_fixture)],
      null
    )
  $$,
  '42501',
  'Authentication is required',
  'service_role replace_entity_tags without p_actor_id is rejected'
);

select ok(
  jsonb_array_length(
    public.replace_entity_tags(
      (select org_id from _tag_actor_fixture),
      'lead',
      (select lead_id from _tag_actor_fixture),
      array[(select tag_id from _tag_actor_fixture)],
      (select owner_id from _tag_actor_fixture)
    )
  ) = 1,
  'service_role replace_entity_tags assigns lead tag with p_actor_id'
);

select ok(
  jsonb_array_length(
    public.list_entity_tags(
      (select org_id from _tag_actor_fixture),
      'lead',
      (select lead_id from _tag_actor_fixture),
      (select owner_id from _tag_actor_fixture)
    )
  ) = 1,
  'service_role list_entity_tags returns lead tags with p_actor_id'
);

select lives_ok(
  $$
    select public.replace_entity_tags(
      (select org_id from _tag_actor_fixture),
      'contact',
      (select contact_id from _tag_actor_fixture),
      array[(select tag_id from _tag_actor_fixture)],
      (select owner_id from _tag_actor_fixture)
    )
  $$,
  'service_role replace_entity_tags works for contact'
);

select lives_ok(
  $$
    select public.replace_entity_tags(
      (select org_id from _tag_actor_fixture),
      'client',
      (select client_id from _tag_actor_fixture),
      array[(select tag_id from _tag_actor_fixture)],
      (select owner_id from _tag_actor_fixture)
    )
  $$,
  'service_role replace_entity_tags works for client'
);

select * from finish();
rollback;

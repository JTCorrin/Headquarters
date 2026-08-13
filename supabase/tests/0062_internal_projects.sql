-- Internal projects: client_id may be null.

begin;

select plan(6);

select ok(
  (
    select is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'projects'
      and column_name = 'client_id'
  ) = 'YES',
  'projects.client_id is nullable'
);

create temporary table _internal_project_fixture (
  owner_id uuid,
  org_id uuid,
  client_id uuid,
  internal_project_id uuid
) on commit drop;

grant all on table _internal_project_fixture to authenticated;

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
    extensions.crypt('internal-project-password', extensions.gen_salt('bf')),
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

insert into _internal_project_fixture (owner_id)
values (pg_temp.make_auth_user('internal-projects-owner@example.test', 'Internal Owner'));

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Internal Projects Org',
    'internal-proj-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
)
update _internal_project_fixture
set org_id = created_org.id
from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _internal_project_fixture;

with created_client as (
  insert into public.clients (org_id, name, status, created_by, updated_by)
  select org_id, 'Acme Client', 'active', owner_id, owner_id
  from _internal_project_fixture
  returning id
)
update _internal_project_fixture
set client_id = created_client.id
from created_client;

select pg_temp.as_user((select owner_id from _internal_project_fixture));
set local role authenticated;

with created as (
  select public.create_project_with_defaults(
    (select org_id from _internal_project_fixture),
    jsonb_build_object('name', 'Website rebuild')
  ) as doc
)
update _internal_project_fixture
set internal_project_id = (created.doc ->> 'id')::uuid
from created;

select ok(
  (
    select client_id is null
    from public.projects
    where id = (select internal_project_id from _internal_project_fixture)
  ),
  'create without client_id stores an internal project'
);

select is(
  (
    select count(*)::integer
    from public.project_columns
    where project_id = (select internal_project_id from _internal_project_fixture)
      and deleted_at is null
  ),
  4,
  'internal project still seeds default columns'
);

select throws_ok(
  $$
    select public.create_project_with_defaults(
      (select org_id from _internal_project_fixture),
      jsonb_build_object(
        'name', 'Bad client',
        'client_id', gen_random_uuid()
      )
    )
  $$,
  '22023',
  null,
  'invalid client_id is still rejected'
);

update public.projects
set client_id = (select client_id from _internal_project_fixture)
where id = (select internal_project_id from _internal_project_fixture);

select is(
  (select client_id from public.projects where id = (select internal_project_id from _internal_project_fixture)),
  (select client_id from _internal_project_fixture),
  'internal project can later attach to a client'
);

update public.projects
set client_id = null
where id = (select internal_project_id from _internal_project_fixture);

select ok(
  (
    select client_id is null
    from public.projects
    where id = (select internal_project_id from _internal_project_fixture)
  ),
  'client-attached project can become internal'
);

select finish();
rollback;

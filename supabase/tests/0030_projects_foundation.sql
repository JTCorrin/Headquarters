begin;

select plan(20);

select has_table('public', 'projects', 'projects table exists');
select has_table('public', 'project_columns', 'project_columns table exists');
select has_table('public', 'project_cards', 'project_cards table exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.projects'::regclass),
  'projects have row level security enabled'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.project_columns'::regclass),
  'project_columns have row level security enabled'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.project_cards'::regclass),
  'project_cards have row level security enabled'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_project_with_defaults(uuid, jsonb, uuid)',
    'execute'
  ),
  'authenticated users can execute create_project_with_defaults'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.soft_delete_project(uuid, uuid, integer)',
    'execute'
  ),
  'authenticated users can execute soft_delete_project'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'projects'
      and indexname = 'projects_org_status_board_idx'
  ),
  'projects status board index exists'
);

create temporary table _projects_fixture (
  owner_id uuid,
  member_id uuid,
  billing_id uuid,
  outsider_id uuid,
  org_id uuid,
  other_org_id uuid,
  client_id uuid,
  owner_project_id uuid,
  owner_project_version integer,
  member_project_id uuid,
  member_project_version integer,
  backlog_column_id uuid,
  owner_card_id uuid
) on commit drop;

grant all on table _projects_fixture to authenticated;

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
    extensions.crypt('projects-test-password', extensions.gen_salt('bf')),
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

insert into _projects_fixture (owner_id, member_id, billing_id, outsider_id)
values (
  pg_temp.make_auth_user('projects-owner@example.test', 'Projects Owner'),
  pg_temp.make_auth_user('projects-member@example.test', 'Projects Member'),
  pg_temp.make_auth_user('projects-billing@example.test', 'Projects Billing'),
  pg_temp.make_auth_user('projects-outsider@example.test', 'Projects Outsider')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Projects Org',
    'projects-org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
),
other_org as (
  insert into public.organisations (name, slug, country_code)
  values (
    'Other Projects Org',
    'other-projects-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB'
  )
  returning id
)
update _projects_fixture
set org_id = created_org.id, other_org_id = other_org.id
from created_org, other_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _projects_fixture;
insert into public.memberships (org_id, user_id, role, status)
select org_id, member_id, 'member', 'active' from _projects_fixture;
insert into public.memberships (org_id, user_id, role, status)
select org_id, billing_id, 'billing', 'active' from _projects_fixture;
insert into public.memberships (org_id, user_id, role, status)
select other_org_id, outsider_id, 'owner', 'active' from _projects_fixture;

with created_client as (
  insert into public.clients (org_id, name, status, created_by, updated_by)
  select org_id, 'Acme Client', 'active', owner_id, owner_id
  from _projects_fixture
  returning id
)
update _projects_fixture
set client_id = created_client.id
from created_client;

select pg_temp.as_user((select owner_id from _projects_fixture));
set local role authenticated;

with owner_project as (
  select public.create_project_with_defaults(
    (select org_id from _projects_fixture),
    jsonb_build_object(
      'client_id', (select client_id from _projects_fixture),
      'name', 'Owner rollout'
    )
  ) as doc
)
update _projects_fixture
set
  owner_project_id = (owner_project.doc ->> 'id')::uuid,
  owner_project_version = (owner_project.doc ->> 'version')::integer
from owner_project;

select pg_temp.as_user((select member_id from _projects_fixture));
set local role authenticated;

with member_project as (
  select public.create_project_with_defaults(
    (select org_id from _projects_fixture),
    jsonb_build_object(
      'client_id', (select client_id from _projects_fixture),
      'name', 'Member workspace'
    )
  ) as doc
)
update _projects_fixture
set
  member_project_id = (member_project.doc ->> 'id')::uuid,
  member_project_version = (member_project.doc ->> 'version')::integer
from member_project;

select is(
  (select status from public.projects where id = (select member_project_id from _projects_fixture)),
  'planning',
  'status defaults to planning'
);

select is(
  (
    select count(*)::integer
    from public.project_columns
    where project_id = (select member_project_id from _projects_fixture)
      and deleted_at is null
  ),
  4,
  'create_project_with_defaults seeds four columns'
);

select is(
  (
    select array_agg(key order by position)
    from public.project_columns
    where project_id = (select member_project_id from _projects_fixture)
      and deleted_at is null
  ),
  array['backlog', 'doing', 'review', 'done'],
  'default column keys are backlog, doing, review, done'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '', true);

update _projects_fixture
set backlog_column_id = project_columns.id
from public.project_columns
where project_columns.project_id = _projects_fixture.owner_project_id
  and project_columns.key = 'backlog';

with owner_card as (
  insert into public.project_cards (
    org_id, project_id, column_id, title, created_by, updated_by
  )
  select
    org_id,
    owner_project_id,
    backlog_column_id,
    'Card blocking column delete',
    owner_id,
    owner_id
  from _projects_fixture
  returning id
)
update _projects_fixture
set owner_card_id = owner_card.id
from owner_card;

select pg_temp.as_user((select billing_id from _projects_fixture));
set local role authenticated;

select is(
  (
    select count(*)::integer from public.projects
    where org_id = (select org_id from _projects_fixture)
  ),
  0,
  'billing member sees zero projects under RLS'
);

reset role;
select pg_temp.as_user((select member_id from _projects_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.soft_delete_project(
      (select owner_project_id from _projects_fixture),
      (select org_id from _projects_fixture),
      (select owner_project_version from _projects_fixture)
    )
  $$,
  '42501',
  null,
  'member cannot soft-delete owner project'
);

select lives_ok(
  $$
    select public.soft_delete_project(
      (select member_project_id from _projects_fixture),
      (select org_id from _projects_fixture),
      (select member_project_version from _projects_fixture)
    )
  $$,
  'member can soft-delete their own project'
);

select is(
  (
    select count(*)::integer from public.project_columns
    where project_id = (select member_project_id from _projects_fixture)
  ),
  0,
  'soft-deleted project hides columns by RLS'
);

select is(
  (
    select count(*)::integer from public.project_cards
    where project_id = (select member_project_id from _projects_fixture)
  ),
  0,
  'soft-deleted project hides cards by RLS'
);

reset role;
select pg_temp.as_user((select owner_id from _projects_fixture));
set local role authenticated;

select throws_ok(
  $$
  insert into public.meetings (
    org_id, title, starts_at, ends_at, timezone,
    related_entity_type, related_entity_id, created_by, updated_by
  )
  select
    org_id,
    'Missing project',
    now() + interval '3 days',
    now() + interval '3 days 1 hour',
    'UTC',
    'project',
    gen_random_uuid(),
    owner_id,
    owner_id
  from _projects_fixture;
  $$,
  '23514',
  null,
  'related project must resolve in organisation'
);

select lives_ok(
  $$
  insert into public.meetings (
    org_id, title, starts_at, ends_at, timezone,
    related_entity_type, related_entity_id, created_by, updated_by
  )
  select
    org_id,
    'Linked project',
    now() + interval '4 days',
    now() + interval '4 days 1 hour',
    'UTC',
    'project',
    owner_project_id,
    owner_id,
    owner_id
  from _projects_fixture;
  $$,
  'meeting may relate to an active project'
);

select throws_ok(
  $$
    select public.soft_delete_project_column(
      (select backlog_column_id from _projects_fixture),
      (select org_id from _projects_fixture),
      (
        select version from public.project_columns
        where id = (select backlog_column_id from _projects_fixture)
      )
    )
  $$,
  '22023',
  null,
  'cannot delete column with live cards'
);

select finish();
rollback;

begin;

select plan(16);

select has_table('public', 'tasks', 'tasks table exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.tasks'::regclass),
  'tasks have row level security enabled'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.soft_delete_task(uuid, uuid, integer)',
    'execute'
  ),
  'authenticated users can execute soft_delete_task'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'tasks'
      and indexname = 'tasks_org_assignee_idx'
  ),
  'tasks assignee index exists'
);

create temporary table _tasks_fixture (
  owner_id uuid,
  member_id uuid,
  member_membership_id uuid,
  billing_id uuid,
  outsider_id uuid,
  org_id uuid,
  other_org_id uuid,
  contact_id uuid,
  owner_task_id uuid,
  owner_task_version integer,
  member_task_id uuid,
  member_task_version integer
) on commit drop;

grant all on table _tasks_fixture to authenticated;

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
    extensions.crypt('tasks-test-password', extensions.gen_salt('bf')),
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

insert into _tasks_fixture (owner_id, member_id, billing_id, outsider_id)
values (
  pg_temp.make_auth_user('tasks-owner@example.test', 'Tasks Owner'),
  pg_temp.make_auth_user('tasks-member@example.test', 'Tasks Member'),
  pg_temp.make_auth_user('tasks-billing@example.test', 'Tasks Billing'),
  pg_temp.make_auth_user('tasks-outsider@example.test', 'Tasks Outsider')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Tasks Org',
    'tasks-org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
),
other_org as (
  insert into public.organisations (name, slug, country_code)
  values (
    'Other Tasks Org',
    'other-tasks-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB'
  )
  returning id
)
update _tasks_fixture
set org_id = created_org.id, other_org_id = other_org.id
from created_org, other_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _tasks_fixture;
insert into public.memberships (org_id, user_id, role, status)
select org_id, member_id, 'member', 'active' from _tasks_fixture;
insert into public.memberships (org_id, user_id, role, status)
select org_id, billing_id, 'billing', 'active' from _tasks_fixture;
insert into public.memberships (org_id, user_id, role, status)
select other_org_id, outsider_id, 'owner', 'active' from _tasks_fixture;

update _tasks_fixture
set member_membership_id = memberships.id
from public.memberships
where memberships.org_id = _tasks_fixture.org_id
  and memberships.user_id = _tasks_fixture.member_id;

-- Seed as table owner (superuser), mirror soft_delete_product fixture style.
with created_contact as (
  insert into public.contacts (org_id, display_name, primary_email, created_by, updated_by)
  select org_id, 'Ada Contact', 'ada@tasks.test', owner_id, owner_id
  from _tasks_fixture
  returning id
)
update _tasks_fixture
set contact_id = created_contact.id
from created_contact;

with owner_task as (
  insert into public.tasks (
    org_id, title, priority, status, source, assignee_membership_id,
    entity_type, entity_id, created_by, updated_by
  )
  select
    org_id, 'Owner task', 'p2', 'open', 'manual', member_membership_id,
    'contact', contact_id, owner_id, owner_id
  from _tasks_fixture
  returning id, version
)
update _tasks_fixture
set
  owner_task_id = owner_task.id,
  owner_task_version = owner_task.version
from owner_task;

with member_task as (
  insert into public.tasks (
    org_id, title, status, created_by, updated_by
  )
  select org_id, 'Member task', 'open', member_id, member_id
  from _tasks_fixture
  returning id, version
)
update _tasks_fixture
set
  member_task_id = member_task.id,
  member_task_version = member_task.version
from member_task;

select is(
  (select priority from public.tasks where id = (select owner_task_id from _tasks_fixture)),
  'p2',
  'owner task keeps requested priority'
);

select is(
  (select priority from public.tasks where id = (select member_task_id from _tasks_fixture)),
  'p3',
  'priority defaults to p3'
);

select is(
  (select source from public.tasks where id = (select member_task_id from _tasks_fixture)),
  'manual',
  'source defaults to manual'
);

select throws_ok(
  $$
  insert into public.tasks (
    org_id, title, assignee_membership_id, created_by, updated_by
  )
  select
    f.org_id,
    'Bad assignee',
    m.id,
    f.owner_id,
    f.owner_id
  from _tasks_fixture f
  join public.memberships m on m.org_id = f.other_org_id
  limit 1;
  $$,
  '23503',
  null,
  'assignee membership must belong to same organisation (FK)'
);

select throws_ok(
  $$
  insert into public.tasks (
    org_id, title, entity_type, entity_id, created_by, updated_by
  )
  select org_id, 'Missing entity', 'contact', gen_random_uuid(), owner_id, owner_id
  from _tasks_fixture;
  $$,
  '23514',
  'Task entity contact not found in organisation',
  'entity link must resolve in organisation'
);

-- Authenticated RLS / soft-delete gates
select pg_temp.as_user((select billing_id from _tasks_fixture));
set local role authenticated;

select is(
  (
    select count(*)::int from public.tasks
    where org_id = (select org_id from _tasks_fixture)
  ),
  0,
  'billing member sees zero tasks under RLS'
);

reset role;
select pg_temp.as_user((select outsider_id from _tasks_fixture));
set local role authenticated;

select is(
  (
    select count(*)::int from public.tasks
    where id = (select owner_task_id from _tasks_fixture)
  ),
  0,
  'cross-org outsider sees zero tasks under RLS'
);

reset role;
select pg_temp.as_user((select member_id from _tasks_fixture));
set local role authenticated;

select throws_ok(
  $$
  select public.soft_delete_task(
    (select owner_task_id from _tasks_fixture),
    (select org_id from _tasks_fixture),
    (select owner_task_version from _tasks_fixture)
  );
  $$,
  '42501',
  'This action is not permitted',
  'member cannot soft-delete owner task'
);

select lives_ok(
  $$
  select public.soft_delete_task(
    (select member_task_id from _tasks_fixture),
    (select org_id from _tasks_fixture),
    (select member_task_version from _tasks_fixture)
  );
  $$,
  'member can soft-delete their own task'
);

reset role;
select pg_temp.as_user((select owner_id from _tasks_fixture));
set local role authenticated;

select throws_ok(
  $$
  select public.soft_delete_task(
    (select owner_task_id from _tasks_fixture),
    (select org_id from _tasks_fixture),
    0
  );
  $$,
  'P0001',
  'Task version conflict',
  'soft_delete_task rejects stale version'
);

select lives_ok(
  $$
  select public.soft_delete_task(
    (select owner_task_id from _tasks_fixture),
    (select org_id from _tasks_fixture),
    (select owner_task_version from _tasks_fixture)
  );
  $$,
  'owner can soft-delete a task with matching version'
);

select is(
  (
    select count(*)::int from public.tasks
    where id = (select owner_task_id from _tasks_fixture)
  ),
  0,
  'soft-deleted task is hidden by RLS'
);

select finish();
rollback;

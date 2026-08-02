begin;

select plan(4);

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

select finish();
rollback;

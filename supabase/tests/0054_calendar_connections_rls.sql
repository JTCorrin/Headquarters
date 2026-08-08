begin;

select plan(5);

select has_table('public', 'calendar_connections', 'calendar_connections table exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.calendar_connections'::regclass),
  'calendar_connections have row level security enabled'
);

select ok(
  not has_column_privilege(
    'authenticated',
    'public.calendar_connections',
    'secret_ref',
    'select'
  ),
  'authenticated cannot select calendar_connections.secret_ref'
);

select ok(
  not has_table_privilege('authenticated', 'private.calendar_oauth_states', 'select'),
  'authenticated cannot select private.calendar_oauth_states'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'calendar_connections'
      and policyname = 'calendar_connections_select_owner'
  ),
  'calendar_connections_select_owner policy exists'
);

select * from finish();
rollback;

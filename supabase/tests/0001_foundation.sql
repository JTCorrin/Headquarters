begin;

select plan(13);

select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'organisations', 'organisations table exists');
select has_table('public', 'memberships', 'memberships table exists');
select has_table('public', 'contacts', 'contacts table exists');

select has_column('public', 'contacts', 'org_id', 'contacts are organisation scoped');
select has_column('public', 'contacts', 'version', 'contacts support optimistic concurrency');
select has_column('public', 'contacts', 'deleted_at', 'contacts support soft deletion');

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.contacts'::regclass
  ),
  'contacts have row level security enabled'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'contacts'
      and policyname = 'contacts_select_member'
  ),
  'contacts select policy exists'
);

select ok(
  exists (
    select 1
    from pg_proc
    join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'public'
      and pg_proc.proname = 'create_organisation'
  ),
  'create_organisation RPC exists'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'memberships'
      and indexname = 'memberships_one_active_owner_per_org_idx'
  ),
  'one-active-owner index exists'
);

select ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('profiles', 'organisations', 'memberships', 'contacts')
      and grantee = 'anon'
  ),
  'anonymous role has no foundation table grants'
);

select ok(
  not exists (
    select 1
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'contacts'
      and column_name in ('created_at', 'created_by', 'org_id', 'updated_at', 'updated_by', 'version')
      and grantee = 'authenticated'
      and privilege_type = 'UPDATE'
  ),
  'authenticated users cannot update contact tenancy or audit columns'
);

select * from finish();

rollback;

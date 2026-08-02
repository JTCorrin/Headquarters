begin;

select plan(28);

select has_table('private', 'integration_secrets', 'private.integration_secrets exists');
select has_table('private', 'encryption_keys', 'private.encryption_keys exists');
select has_table('public', 'mailbox_accounts', 'mailbox_accounts table exists');
select has_table('public', 'email_threads', 'email_threads table exists');
select has_table('public', 'email_messages', 'email_messages table exists');
select has_table('public', 'email_message_reads', 'email_message_reads table exists');
select has_table('public', 'email_message_links', 'email_message_links table exists');
select has_table('public', 'integrations', 'integrations table exists');

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.mailbox_accounts'::regclass
  ),
  'mailbox_accounts have RLS enabled'
);

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.email_messages'::regclass
  ),
  'email_messages have RLS enabled'
);

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.integrations'::regclass
  ),
  'integrations have RLS enabled'
);

select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'mailbox_accounts'
      and policyname = 'mailbox_accounts_select_owner'
  ),
  'mailbox_accounts owner select policy exists'
);

select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'email_messages'
      and policyname = 'email_messages_select_owner_or_share'
  ),
  'email_messages ownership/share select policy exists'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'mailbox_accounts'
      and indexname = 'mailbox_accounts_org_membership_uidx'
  ),
  'one active mailbox per membership'
);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'email_message_links'
      and column_name = 'link_reason'
  ),
  'email_message_links.link_reason exists'
);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mailbox_accounts'
      and column_name = 'sync_lookback_days'
  ),
  'mailbox sync lookback bound column exists'
);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mailbox_accounts'
      and column_name = 'sync_max_messages'
  ),
  'mailbox sync max messages bound column exists'
);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mailbox_accounts'
      and column_name = 'consecutive_auth_failures'
  ),
  'mailbox auth circuit-breaker column exists'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.upsert_mailbox_account(uuid, text, text, text, integer, text, text, integer, text, text, text)',
    'execute'
  ),
  'authenticated can execute upsert_mailbox_account'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.disconnect_mailbox_account(uuid)',
    'execute'
  ),
  'authenticated can execute disconnect_mailbox_account'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.get_mailbox_account(uuid)',
    'execute'
  ),
  'authenticated can execute get_mailbox_account'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.upsert_ai_integration(uuid, text, text)',
    'execute'
  ),
  'authenticated can execute upsert_ai_integration'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.disconnect_ai_integration(uuid, text)',
    'execute'
  ),
  'authenticated can execute disconnect_ai_integration'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.list_ai_integrations(uuid)',
    'execute'
  ),
  'authenticated can execute list_ai_integrations'
);

select ok(
  not has_table_privilege('authenticated', 'private.integration_secrets', 'select'),
  'authenticated cannot select private.integration_secrets'
);

select ok(
  not has_table_privilege('authenticated', 'private.encryption_keys', 'select'),
  'authenticated cannot select private.encryption_keys'
);

select ok(
  not has_column_privilege('authenticated', 'public.mailbox_accounts', 'secret_ref', 'select'),
  'authenticated cannot select mailbox_accounts.secret_ref'
);

select ok(
  not has_column_privilege('authenticated', 'public.integrations', 'secret_ref', 'select'),
  'authenticated cannot select integrations.secret_ref'
);

select ok(
  not has_function_privilege('authenticated', 'private.store_secret(text)', 'execute'),
  'authenticated cannot execute private.store_secret'
);

select ok(
  not has_function_privilege('authenticated', 'private.read_secret(uuid)', 'execute'),
  'authenticated cannot execute private.read_secret'
);

select * from finish();
rollback;

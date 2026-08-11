begin;

select plan(6);

select has_column('public', 'mailbox_accounts', 'auth_mode', 'mailbox_accounts.auth_mode exists');
select has_column('public', 'mailbox_accounts', 'oauth_provider', 'mailbox_accounts.oauth_provider exists');

select ok(
  not has_column_privilege(
    'authenticated',
    'public.mailbox_accounts',
    'secret_ref',
    'select'
  ),
  'authenticated cannot select mailbox_accounts.secret_ref'
);

select ok(
  has_column_privilege(
    'authenticated',
    'public.mailbox_accounts',
    'auth_mode',
    'select'
  ),
  'authenticated can select mailbox_accounts.auth_mode'
);

select ok(
  not has_table_privilege('authenticated', 'private.mailbox_oauth_states', 'select'),
  'authenticated cannot select private.mailbox_oauth_states'
);

select ok(
  has_function_privilege('authenticated', 'public.create_mailbox_oauth_state(uuid, text, text, integer)', 'execute')
  and has_function_privilege('authenticated', 'public.consume_mailbox_oauth_state(uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.upsert_mailbox_account_oauth(uuid, text, text, text, text, text, integer, text, text, integer, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.update_mailbox_oauth_token_blob(uuid, text)', 'execute')
  and has_function_privilege('service_role', 'public.update_mailbox_oauth_token_blob(uuid, text)', 'execute'),
  'OAuth RPCs are granted to the expected roles'
);

select * from finish();
rollback;

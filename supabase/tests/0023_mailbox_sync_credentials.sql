begin;

select plan(2);

select ok(
  has_function_privilege(
    'service_role',
    'public.read_mailbox_sync_credentials(uuid, uuid)',
    'execute'
  ),
  'service_role can execute read_mailbox_sync_credentials'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.read_mailbox_sync_credentials(uuid, uuid)',
    'execute'
  ),
  'authenticated cannot execute read_mailbox_sync_credentials'
);

select * from finish();

rollback;

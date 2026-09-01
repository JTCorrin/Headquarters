begin;

select plan(8);

select ok(
  has_function_privilege(
    'service_role',
    'public.read_mailbox_sync_credentials(uuid, uuid)',
    'execute'
  ),
  'service_role can execute read_mailbox_sync_credentials'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.read_mailbox_sync_credentials(uuid, uuid)',
    'execute'
  ),
  'authenticated can execute org-scoped read_mailbox_sync_credentials'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.begin_email_reply_idempotent(uuid, uuid, text, text, text, integer)',
    'execute'
  ),
  'authenticated can execute begin_email_reply_idempotent'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.abort_email_reply_idempotent(uuid, text)',
    'execute'
  ),
  'authenticated can execute abort_email_reply_idempotent'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.finish_email_reply_idempotent(uuid, uuid, text, text, text, text, text, text, text)',
    'execute'
  ),
  'authenticated can execute finish_email_reply_idempotent'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.begin_email_reply_idempotent(uuid, uuid, text, text, text, integer)',
    'execute'
  ),
  'anon cannot execute begin_email_reply_idempotent'
);

-- Function source must include smtp fields after extension.
select ok(
  (
    select prosrc like '%smtp_host%'
      and prosrc like '%smtp_port%'
      and prosrc like '%smtp_security%'
    from pg_proc
    where oid = 'public.read_mailbox_sync_credentials(uuid, uuid)'::regprocedure
  ),
  'read_mailbox_sync_credentials returns smtp_* fields'
);

select ok(
  (
    select prosrc like '%idempotency_claim_or_replay%'
    from pg_proc
    where oid = 'public.begin_email_reply_idempotent(uuid, uuid, text, text, text, integer)'::regprocedure
  ),
  'begin_email_reply_idempotent claims via private idempotency helper'
);

select * from finish();

rollback;

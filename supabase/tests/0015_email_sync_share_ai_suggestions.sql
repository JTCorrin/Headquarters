begin;

select plan(14);

select has_table('public', 'ai_suggestions', 'ai_suggestions table exists');

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.ai_suggestions'::regclass
  ),
  'ai_suggestions have RLS enabled'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.share_email_message_to_timeline(uuid, uuid, text, uuid)',
    'execute'
  ),
  'authenticated can execute share_email_message_to_timeline'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_email_reply_suggestion(uuid, uuid, text, text, text, text)',
    'execute'
  ),
  'authenticated can execute create_email_reply_suggestion'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.decide_ai_suggestion(uuid, uuid, text, text)',
    'execute'
  ),
  'authenticated can execute decide_ai_suggestion'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.list_entity_email_messages(uuid, text, uuid, integer)',
    'execute'
  ),
  'authenticated can execute list_entity_email_messages'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.claim_mailbox_sync_lease(uuid, text, integer)',
    'execute'
  ),
  'service_role can execute claim_mailbox_sync_lease'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.release_mailbox_sync_lease(uuid, text, boolean, text, boolean)',
    'execute'
  ),
  'service_role can execute release_mailbox_sync_lease'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.list_mailboxes_due_for_sync(integer)',
    'execute'
  ),
  'service_role can execute list_mailboxes_due_for_sync'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.upsert_inbound_email_message(uuid, uuid, text, text, text, text, jsonb, text, text, text, timestamptz, boolean)',
    'execute'
  ),
  'service_role can execute upsert_inbound_email_message'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_mailbox_sync_lease(uuid, text, integer)',
    'execute'
  ),
  'authenticated cannot execute claim_mailbox_sync_lease'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.upsert_inbound_email_message(uuid, uuid, text, text, text, text, jsonb, text, text, text, timestamptz, boolean)',
    'execute'
  ),
  'authenticated cannot execute upsert_inbound_email_message'
);

-- Wave B tightens AI writes to owner-only (replaces Wave A owner/admin).
select ok(
  (
    select prosrc ~ 'has_org_role\(p_org_id, array\[''owner''\]\)'
      and prosrc !~ 'array\[''owner'', ''admin''\]'
    from pg_proc
    where oid = 'public.upsert_ai_integration(uuid, text, text)'::regprocedure
  ),
  'upsert_ai_integration is owner-only'
);

select ok(
  (
    select prosrc ~ 'has_org_role\(p_org_id, array\[''owner''\]\)'
      and prosrc !~ 'array\[''owner'', ''admin''\]'
    from pg_proc
    where oid = 'public.disconnect_ai_integration(uuid, text)'::regprocedure
  ),
  'disconnect_ai_integration is owner-only'
);

select * from finish();
rollback;

-- pgTAP: ai_org_settings + prompt RPCs

begin;
select plan(8);

select has_table('public', 'ai_org_settings', 'ai_org_settings table exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.ai_org_settings'::regclass),
  'ai_org_settings has RLS enabled'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.get_ai_org_prompts(uuid)',
    'execute'
  ),
  'authenticated can execute get_ai_org_prompts'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.upsert_ai_org_prompts(uuid, jsonb)',
    'execute'
  ),
  'authenticated can execute upsert_ai_org_prompts'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_email_reply_suggestion(uuid, uuid, text, text, text, text, text, text)',
    'execute'
  ),
  'authenticated can execute create_email_reply_suggestion with prompt args'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_invoice_chase_suggestion(uuid, uuid, text, text, text, text, text)',
    'execute'
  ),
  'authenticated can execute create_invoice_chase_suggestion'
);

select ok(
  not has_table_privilege('authenticated', 'public.ai_org_settings', 'insert'),
  'authenticated cannot insert ai_org_settings directly'
);

select ok(
  not has_table_privilege('authenticated', 'public.ai_org_settings', 'update'),
  'authenticated cannot update ai_org_settings directly'
);

select * from finish();
rollback;

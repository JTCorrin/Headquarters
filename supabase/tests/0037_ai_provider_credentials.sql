-- Privilege gates for AI credential read + email AI context.

begin;
select plan(5);

select has_function(
  'public',
  'read_ai_integration_credentials',
  array['uuid', 'text'],
  'read_ai_integration_credentials exists'
);

select has_function(
  'public',
  'get_email_message_ai_context',
  array['uuid', 'uuid'],
  'get_email_message_ai_context exists'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.read_ai_integration_credentials(uuid, text)',
    'execute'
  ),
  'authenticated cannot execute read_ai_integration_credentials'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.read_ai_integration_credentials(uuid, text)',
    'execute'
  ),
  'service_role can execute read_ai_integration_credentials'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.get_email_message_ai_context(uuid, uuid)',
    'execute'
  ),
  'authenticated can execute get_email_message_ai_context'
);

select * from finish();
rollback;

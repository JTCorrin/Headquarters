begin;

select plan(1);

select ok(
  has_function_privilege(
    'authenticated',
    'public.list_payments(uuid, integer, timestamptz, uuid, text, text, uuid, uuid, uuid, uuid)',
    'execute'
  ),
  'authenticated can execute list_payments'
);

select * from finish();
rollback;

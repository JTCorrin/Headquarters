begin;

select plan(4);

select ok(
  has_function_privilege(
    'service_role',
    'public.verify_recurring_invoices_cron_secret(text)',
    'execute'
  ),
  'service_role can execute verify_recurring_invoices_cron_secret'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.verify_recurring_invoices_cron_secret(text)',
    'execute'
  ),
  'authenticated cannot execute verify_recurring_invoices_cron_secret'
);

select ok(
  exists(
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname = 'invoke_recurring_invoices_from_cron'
  ),
  'private.invoke_recurring_invoices_from_cron exists'
);

select ok(
  exists(
    select 1 from cron.job where jobname = 'recurring-invoices-every-5m' and active
  ),
  'recurring-invoices-every-5m cron job is active'
);

select * from finish();

rollback;

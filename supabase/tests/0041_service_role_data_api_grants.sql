begin;

select plan(4);

select ok(
  has_table_privilege('service_role', 'public.memberships', 'select'),
  'service_role can select memberships'
);

select ok(
  has_table_privilege('service_role', 'public.contacts', 'select'),
  'service_role can select contacts'
);

select ok(
  has_table_privilege('service_role', 'public.contacts', 'insert'),
  'service_role can insert contacts'
);

select ok(
  has_table_privilege('service_role', 'public.api_keys', 'select'),
  'service_role can select api_keys'
);

select * from finish();
rollback;

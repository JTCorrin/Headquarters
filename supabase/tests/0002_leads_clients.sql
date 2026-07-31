begin;

select plan(28);

select has_table('public', 'leads', 'leads table exists');
select has_table('public', 'clients', 'clients table exists');
select has_table('public', 'client_contacts', 'client_contacts table exists');
select has_table('public', 'timeline_events', 'timeline_events table exists');

select has_column('public', 'leads', 'stage', 'leads track pipeline stage');
select has_column('public', 'leads', 'client_id', 'leads link to converted clients');
select has_column('public', 'clients', 'converted_from_lead_id', 'clients retain conversion provenance');
select has_column('public', 'client_contacts', 'is_primary', 'client contacts track primary contact');

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.leads'::regclass
  ),
  'leads have row level security enabled'
);

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.clients'::regclass
  ),
  'clients have row level security enabled'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'leads'
      and policyname = 'leads_select_member'
  ),
  'leads select policy exists'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'clients'
      and policyname = 'clients_select_member'
  ),
  'clients select policy exists'
);

select ok(
  exists (
    select 1
    from pg_proc
    join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'public'
      and pg_proc.proname = 'convert_lead'
  ),
  'convert_lead RPC exists'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'clients'
      and indexname = 'clients_converted_from_lead_uidx'
  ),
  'converted lead uniqueness is enforced per organisation'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'client_contacts'
      and indexname = 'client_contacts_one_primary_uidx'
  ),
  'one primary client contact is enforced'
);

select ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('leads', 'clients', 'client_contacts', 'timeline_events')
      and grantee = 'anon'
  ),
  'anonymous role has no pipeline table grants'
);

select ok(
  not exists (
    select 1
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'leads'
      and column_name in (
        'client_id',
        'converted_at',
        'created_at',
        'created_by',
        'org_id',
        'updated_at',
        'updated_by',
        'version',
        'won_at'
      )
      and grantee = 'authenticated'
      and privilege_type = 'UPDATE'
  ),
  'authenticated users cannot directly update lead conversion or audit columns'
);

select ok(
  not exists (
    select 1
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'clients'
      and column_name in (
        'converted_from_lead_id',
        'created_at',
        'created_by',
        'org_id',
        'updated_at',
        'updated_by',
        'version'
      )
      and grantee = 'authenticated'
      and privilege_type = 'UPDATE'
  ),
  'authenticated users cannot directly update client conversion or audit columns'
);

select ok(
  not exists (
    select 1
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'timeline_events'
      and grantee = 'authenticated'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ),
  'authenticated users cannot mutate timeline events directly'
);

select ok(
  has_function_privilege('authenticated', 'public.convert_lead(uuid, text, text)', 'execute'),
  'authenticated users can execute convert_lead'
);

select ok(
  not has_function_privilege('anon', 'public.convert_lead(uuid, text, text)', 'execute'),
  'anonymous users cannot execute convert_lead'
);

-- Behavioural conversion: create auth user, org, contact, lead, then convert as that user.
create temporary table _pipeline_fixture (
  user_id uuid,
  org_id uuid,
  membership_id uuid,
  contact_id uuid,
  lead_id uuid,
  client_id uuid
) on commit drop;

with created_user as (
  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    'pipeline-test@example.test',
    extensions.crypt('pipeline-test-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Pipeline Tester"}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  )
  returning id
),
created_org as (
  insert into public.organisations (name, slug, country_code)
  values ('Pipeline Org', 'pipeline-org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8), 'GB')
  returning id
),
created_membership as (
  insert into public.memberships (org_id, user_id, role, status)
  select created_org.id, created_user.id, 'owner', 'active'
  from created_org, created_user
  returning id, org_id, user_id
),
created_contact as (
  insert into public.contacts (
    org_id,
    display_name,
    primary_email,
    primary_phone,
    created_by,
    updated_by
  )
  select
    created_membership.org_id,
    'Casey Contact',
    'casey@example.test',
    '+441234567890',
    created_membership.user_id,
    created_membership.user_id
  from created_membership
  returning id, org_id
),
created_lead as (
  insert into public.leads (
    org_id,
    name,
    company_name,
    contact_id,
    stage,
    currency,
    value_cents,
    created_by,
    updated_by
  )
  select
    created_contact.org_id,
    'Acme Opportunity',
    'Acme Ltd',
    created_contact.id,
    'proposal',
    'GBP',
    250000,
    created_membership.user_id,
    created_membership.user_id
  from created_contact, created_membership
  returning id
)
insert into _pipeline_fixture (user_id, org_id, membership_id, contact_id, lead_id)
select
  created_membership.user_id,
  created_membership.org_id,
  created_membership.id,
  created_contact.id,
  created_lead.id
from created_membership, created_contact, created_lead;

select set_config(
  'request.jwt.claim.sub',
  (select user_id::text from _pipeline_fixture),
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

update _pipeline_fixture
set client_id = (
  select (public.convert_lead(lead_id, null, 'active') -> 'client' ->> 'id')::uuid
  from _pipeline_fixture
);

select ok(
  (select client_id is not null from _pipeline_fixture),
  'convert_lead creates a client for an open lead'
);

select ok(
  (
    select leads.stage = 'won'
      and leads.client_id is not null
      and leads.won_at is not null
      and leads.converted_at is not null
    from public.leads
    join _pipeline_fixture on _pipeline_fixture.lead_id = leads.id
  ),
  'converted lead is marked won and linked to its client'
);

select ok(
  (
    select clients.name = 'Acme Ltd'
      and clients.converted_from_lead_id = _pipeline_fixture.lead_id
      and clients.primary_email = 'casey@example.test'
      and clients.phone = '+441234567890'
    from public.clients
    join _pipeline_fixture on _pipeline_fixture.client_id = clients.id
  ),
  'converted client inherits company name and contact details'
);

select ok(
  exists (
    select 1
    from public.client_contacts
    join _pipeline_fixture
      on _pipeline_fixture.client_id = client_contacts.client_id
     and _pipeline_fixture.contact_id = client_contacts.contact_id
    where client_contacts.is_primary
      and client_contacts.role = 'primary'
  ),
  'convert_lead links the lead contact as the primary client contact'
);

select ok(
  (
    select count(*) = 2
    from public.timeline_events
    join _pipeline_fixture
      on _pipeline_fixture.org_id = timeline_events.org_id
    where timeline_events.kind = 'conversion'
      and (
        (timeline_events.entity_type = 'lead' and timeline_events.entity_id = _pipeline_fixture.lead_id)
        or
        (timeline_events.entity_type = 'client' and timeline_events.entity_id = _pipeline_fixture.client_id)
      )
  ),
  'convert_lead emits lead and client conversion timeline events'
);

select ok(
  (
    select (public.convert_lead(lead_id) ->> 'idempotent')::boolean
    from _pipeline_fixture
  ),
  'convert_lead is idempotent for an already converted lead'
);

select throws_ok(
  $$
    insert into public.leads (
      org_id,
      name,
      stage,
      currency,
      lost_reason,
      created_by,
      updated_by
    )
    select
      org_id,
      'Lost Without Timestamp',
      'lost',
      'GBP',
      'no budget',
      user_id,
      user_id
    from _pipeline_fixture
  $$,
  '23514',
  null,
  'lost leads require lost_at'
);

select * from finish();

rollback;

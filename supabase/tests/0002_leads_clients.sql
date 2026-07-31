begin;

select plan(43);

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

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.leads'::regclass
      and conname = 'leads_conversion_invariant_check'
  ),
  'leads conversion invariant check exists'
);

-- Fixtures: owner + billing + readonly in org A; outsider owner in org B.
create temporary table _pipeline_fixture (
  owner_id uuid,
  billing_id uuid,
  readonly_id uuid,
  outsider_id uuid,
  org_id uuid,
  other_org_id uuid,
  owner_membership_id uuid,
  billing_membership_id uuid,
  readonly_membership_id uuid,
  contact_id uuid,
  lead_id uuid,
  other_lead_id uuid,
  client_id uuid
) on commit drop;

grant all on table _pipeline_fixture to authenticated;

create or replace function pg_temp.make_auth_user(p_email text, p_name text)
returns uuid
language plpgsql
as $$
declare
  created_id uuid := gen_random_uuid();
begin
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
    created_id,
    'authenticated',
    'authenticated',
    p_email,
    extensions.crypt('pipeline-test-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('display_name', p_name),
    now(),
    now(),
    '',
    '',
    '',
    ''
  );
  return created_id;
end;
$$;

insert into _pipeline_fixture (
  owner_id,
  billing_id,
  readonly_id,
  outsider_id
)
values (
  pg_temp.make_auth_user('pipeline-owner@example.test', 'Pipeline Owner'),
  pg_temp.make_auth_user('pipeline-billing@example.test', 'Pipeline Billing'),
  pg_temp.make_auth_user('pipeline-readonly@example.test', 'Pipeline Readonly'),
  pg_temp.make_auth_user('pipeline-outsider@example.test', 'Pipeline Outsider')
);

with created_org as (
  insert into public.organisations (name, slug, country_code)
  values (
    'Pipeline Org',
    'pipeline-org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB'
  )
  returning id
),
other_org as (
  insert into public.organisations (name, slug, country_code)
  values (
    'Other Org',
    'other-org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB'
  )
  returning id
)
update _pipeline_fixture
set
  org_id = created_org.id,
  other_org_id = other_org.id
from created_org, other_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _pipeline_fixture;

insert into public.memberships (org_id, user_id, role, status)
select org_id, billing_id, 'billing', 'active' from _pipeline_fixture;

insert into public.memberships (org_id, user_id, role, status)
select org_id, readonly_id, 'readonly', 'active' from _pipeline_fixture;

insert into public.memberships (org_id, user_id, role, status)
select other_org_id, outsider_id, 'owner', 'active' from _pipeline_fixture;

update _pipeline_fixture
set
  owner_membership_id = (
    select memberships.id
    from public.memberships
    join _pipeline_fixture f on f.org_id = memberships.org_id and f.owner_id = memberships.user_id
  ),
  billing_membership_id = (
    select memberships.id
    from public.memberships
    join _pipeline_fixture f on f.org_id = memberships.org_id and f.billing_id = memberships.user_id
  ),
  readonly_membership_id = (
    select memberships.id
    from public.memberships
    join _pipeline_fixture f on f.org_id = memberships.org_id and f.readonly_id = memberships.user_id
  );

with created_contact as (
  insert into public.contacts (
    org_id,
    display_name,
    primary_email,
    primary_phone,
    created_by,
    updated_by
  )
  select
    org_id,
    'Casey Contact',
    'casey@example.test',
    '+441234567890',
    owner_id,
    owner_id
  from _pipeline_fixture
  returning id
)
update _pipeline_fixture
set contact_id = created_contact.id
from created_contact;

with created_lead as (
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
    org_id,
    'Acme Opportunity',
    'Acme Ltd',
    contact_id,
    'proposal',
    'GBP',
    250000,
    owner_id,
    owner_id
  from _pipeline_fixture
  returning id
)
update _pipeline_fixture
set lead_id = created_lead.id
from created_lead;

with created_other_lead as (
  insert into public.leads (
    org_id,
    name,
    stage,
    currency,
    created_by,
    updated_by
  )
  select
    other_org_id,
    'Other Org Lead',
    'new',
    'GBP',
    outsider_id,
    outsider_id
  from _pipeline_fixture
  returning id
)
update _pipeline_fixture
set other_lead_id = created_other_lead.id
from created_other_lead;

create or replace function pg_temp.as_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true
  );
end;
$$;

grant execute on function pg_temp.as_user(uuid) to authenticated;

-- Authenticated conversion happy path
select pg_temp.as_user((select owner_id from _pipeline_fixture));
set local role authenticated;

update _pipeline_fixture
set client_id = (
  select (public.convert_lead(lead_id, null, 'active') -> 'client' ->> 'id')::uuid
  from _pipeline_fixture
);

reset role;

select ok(
  (select client_id is not null from _pipeline_fixture),
  'authenticated convert_lead creates a client for an open lead'
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

select pg_temp.as_user((select owner_id from _pipeline_fixture));
set local role authenticated;

select ok(
  (
    select (public.convert_lead(lead_id) ->> 'idempotent')::boolean
    from _pipeline_fixture
  ),
  'convert_lead is idempotent for an already converted lead'
);

-- Lifecycle bypass: authenticated cannot reopen a won lead
select throws_ok(
  $$
    update public.leads
    set stage = 'proposal', lost_reason = null, lost_at = null
    where id = (select lead_id from _pipeline_fixture)
  $$,
  '23514',
  null,
  'authenticated role cannot reopen a converted won lead'
);

-- Soft-delete of converted client is blocked
select throws_ok(
  $$
    update public.clients
    set deleted_at = now()
    where id = (select client_id from _pipeline_fixture)
  $$,
  '23514',
  null,
  'authenticated role cannot soft-delete a client linked from a converted lead'
);

reset role;

-- Soft-deleted contact cannot be converted (contact was live when linked, then deleted).
create temporary table _deleted_contact_case (
  lead_id uuid,
  contact_id uuid
) on commit drop;

grant all on table _deleted_contact_case to authenticated;

with created_contact as (
  insert into public.contacts (
    org_id,
    display_name,
    primary_email,
    created_by,
    updated_by
  )
  select
    org_id,
    'Soon Deleted Contact',
    'deleted@example.test',
    owner_id,
    owner_id
  from _pipeline_fixture
  returning id
),
created_lead as (
  insert into public.leads (
    org_id,
    name,
    contact_id,
    stage,
    currency,
    created_by,
    updated_by
  )
  select
    f.org_id,
    'Lead With Deleted Contact',
    created_contact.id,
    'qualified',
    'GBP',
    f.owner_id,
    f.owner_id
  from _pipeline_fixture f, created_contact
  returning id, contact_id
)
insert into _deleted_contact_case (lead_id, contact_id)
select id, contact_id from created_lead;

update public.contacts
set deleted_at = now()
where id = (select contact_id from _deleted_contact_case);

select pg_temp.as_user((select owner_id from _pipeline_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.convert_lead((select lead_id from _deleted_contact_case))
  $$,
  '22023',
  null,
  'convert_lead rejects soft-deleted lead contacts'
);

-- Cross-tenant isolation
select is_empty(
  $$
    select id from public.leads
    where id = (select other_lead_id from _pipeline_fixture)
  $$,
  'authenticated owner cannot read another organisation lead'
);

select throws_ok(
  $$
    select public.convert_lead((select other_lead_id from _pipeline_fixture))
  $$,
  '42501',
  null,
  'convert_lead denies conversion outside the caller organisation'
);

-- Billing: no leads, no lead timeline, can read clients
select pg_temp.as_user((select billing_id from _pipeline_fixture));

select is_empty(
  $$
    select id from public.leads
    where id = (select lead_id from _pipeline_fixture)
  $$,
  'billing role cannot select leads'
);

select is_empty(
  $$
    select id from public.timeline_events
    where entity_type = 'lead'
      and entity_id = (select lead_id from _pipeline_fixture)
  $$,
  'billing role cannot select lead timeline events'
);

select ok(
  exists (
    select 1
    from public.clients
    where id = (select client_id from _pipeline_fixture)
  ),
  'billing role can select clients'
);

select throws_ok(
  $$
    select public.convert_lead((select lead_id from _pipeline_fixture))
  $$,
  '42501',
  null,
  'billing role cannot execute convert_lead'
);

-- Readonly: can read leads, cannot write or convert
select pg_temp.as_user((select readonly_id from _pipeline_fixture));

select ok(
  exists (
    select 1
    from public.leads
    where id = (select lead_id from _pipeline_fixture)
  ),
  'readonly role can select leads'
);

select throws_ok(
  $$
    insert into public.leads (org_id, name, stage, currency, created_by, updated_by)
    select org_id, 'Readonly Create', 'new', 'GBP', readonly_id, readonly_id
    from _pipeline_fixture
  $$,
  '42501',
  null,
  'readonly role cannot insert leads'
);

select throws_ok(
  $$
    select public.convert_lead((select lead_id from _pipeline_fixture))
  $$,
  '42501',
  null,
  'readonly role cannot execute convert_lead'
);

-- Outsider (other org owner) cannot read org A pipeline rows
select pg_temp.as_user((select outsider_id from _pipeline_fixture));

select is_empty(
  $$
    select id from public.leads
    where id = (select lead_id from _pipeline_fixture)
  $$,
  'outsider cannot select another organisation lead'
);

select is_empty(
  $$
    select id from public.clients
    where id = (select client_id from _pipeline_fixture)
  $$,
  'outsider cannot select another organisation client'
);

reset role;

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
      owner_id,
      owner_id
    from _pipeline_fixture
  $$,
  '23514',
  null,
  'lost leads require lost_at'
);

select * from finish();

rollback;

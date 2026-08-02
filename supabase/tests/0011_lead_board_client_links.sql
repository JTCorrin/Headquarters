begin;

select plan(16);

select ok(
  exists (
    select 1
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'leads'
      and column_name = 'client_id'
      and grantee = 'authenticated'
      and privilege_type = 'UPDATE'
  ),
  'authenticated users can update lead client_id for pre-conversion links'
);

select ok(
  exists (
    select 1
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'leads'
      and column_name = 'client_id'
      and grantee = 'authenticated'
      and privilege_type = 'INSERT'
  ),
  'authenticated users can insert lead client_id for pre-conversion links'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.convert_lead(uuid, text, text)',
    'execute'
  ),
  'authenticated users can still execute convert_lead'
);

create temporary table _link_fixture (
  owner_id uuid,
  outsider_id uuid,
  org_id uuid,
  other_org_id uuid,
  contact_id uuid,
  contact_version integer,
  prior_primary_contact_id uuid,
  prior_primary_version integer,
  client_id uuid,
  other_client_id uuid,
  lead_id uuid
) on commit drop;

grant all on table _link_fixture to authenticated;

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
    extensions.crypt('link-fixture-password', extensions.gen_salt('bf')),
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

insert into _link_fixture (owner_id, outsider_id)
values (
  pg_temp.make_auth_user('link-owner@example.test', 'Link Owner'),
  pg_temp.make_auth_user('link-outsider@example.test', 'Link Outsider')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Link Org',
    'link-org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
),
other_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Other Link Org',
    'link-other-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'USD'
  )
  returning id
)
update _link_fixture
set
  org_id = created_org.id,
  other_org_id = other_org.id
from created_org, other_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _link_fixture;

insert into public.memberships (org_id, user_id, role, status)
select other_org_id, outsider_id, 'owner', 'active' from _link_fixture;

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
    'Link Contact',
    'link@example.test',
    owner_id,
    owner_id
  from _link_fixture
  returning id
)
update _link_fixture
set contact_id = created_contact.id
from created_contact;

with created_client as (
  insert into public.clients (
    org_id,
    name,
    status,
    default_currency,
    created_by,
    updated_by
  )
  select
    org_id,
    'Link Client',
    'active',
    'USD',
    owner_id,
    owner_id
  from _link_fixture
  returning id
)
update _link_fixture
set client_id = created_client.id
from created_client;

with created_other_client as (
  insert into public.clients (
    org_id,
    name,
    status,
    default_currency,
    created_by,
    updated_by
  )
  select
    other_org_id,
    'Other Client',
    'active',
    'EUR',
    outsider_id,
    outsider_id
  from _link_fixture
  returning id
)
update _link_fixture
set other_client_id = created_other_client.id
from created_other_client;

with created_lead as (
  insert into public.leads (
    org_id,
    name,
    contact_id,
    stage,
    currency,
    position,
    created_by,
    updated_by
  )
  select
    org_id,
    'Board Lead',
    contact_id,
    'new',
    'GBP',
    1,
    owner_id,
    owner_id
  from _link_fixture
  returning id
)
update _link_fixture
set lead_id = created_lead.id
from created_lead;

-- Open lead may set same-org client_id with stage+position atomically
select pg_temp.as_user((select owner_id from _link_fixture));
set local role authenticated;

select lives_ok(
  $$
    update public.leads
    set
      client_id = (select client_id from _link_fixture),
      position = 42.5,
      stage = 'qualified'
    where id = (select lead_id from _link_fixture)
  $$,
  'open lead can set client_id with stage+position in one update'
);

reset role;

select ok(
  (
    select leads.client_id = _link_fixture.client_id
      and leads.stage = 'qualified'
      and leads.position = 42.5
      and leads.won_at is null
      and leads.converted_at is null
    from public.leads
    join _link_fixture on _link_fixture.lead_id = leads.id
  ),
  'pre-conversion client_id persists without marking the lead won'
);

-- Cross-org client_id denied by validate_lead_client
select pg_temp.as_user((select owner_id from _link_fixture));
set local role authenticated;

select throws_ok(
  $$
    update public.leads
    set client_id = (select other_client_id from _link_fixture)
    where id = (select lead_id from _link_fixture)
  $$,
  '23514',
  null,
  'lead client_id must be an active client in the same organisation'
);

reset role;

-- Seed: another contact is already primary; lead contact is a non-primary link.
-- convert_lead must promote the lead contact (not skip because a link exists).
with prior_contact as (
  insert into public.contacts (
    org_id,
    display_name,
    primary_email,
    created_by,
    updated_by
  )
  select
    org_id,
    'Prior Primary Contact',
    'prior-primary@example.test',
    owner_id,
    owner_id
  from _link_fixture
  returning id
)
update _link_fixture
set prior_primary_contact_id = prior_contact.id
from prior_contact;

insert into public.client_contacts (
  org_id, client_id, contact_id, role, is_primary, created_by, updated_by
)
select
  org_id, client_id, prior_primary_contact_id, 'primary', true, owner_id, owner_id
from _link_fixture;

insert into public.client_contacts (
  org_id, client_id, contact_id, role, is_primary, created_by, updated_by
)
select
  org_id, client_id, contact_id, 'billing', false, owner_id, owner_id
from _link_fixture;

update _link_fixture
set
  contact_version = (select version from public.contacts where id = contact_id),
  prior_primary_version = (
    select version from public.contacts where id = prior_primary_contact_id
  );

-- convert_lead reuses the pre-linked client and promotes the contact to primary
select pg_temp.as_user((select owner_id from _link_fixture));
set local role authenticated;

select ok(
  (
    select (public.convert_lead(lead_id) -> 'client' ->> 'id')::uuid = client_id
    from _link_fixture
  ),
  'convert_lead reuses a pre-linked client_id'
);

reset role;

select ok(
  (
    select leads.stage = 'won'
      and leads.client_id = _link_fixture.client_id
      and leads.won_at is not null
      and leads.converted_at is not null
    from public.leads
    join _link_fixture on _link_fixture.lead_id = leads.id
  ),
  'convert after pre-link marks the lead won with conversion timestamps'
);

select ok(
  (
    select clients.converted_from_lead_id = _link_fixture.lead_id
    from public.clients
    join _link_fixture on _link_fixture.client_id = clients.id
  ),
  'reused client gains converted_from_lead_id provenance when missing'
);

select ok(
  exists (
    select 1
    from public.client_contacts
    join _link_fixture
      on _link_fixture.client_id = client_contacts.client_id
     and _link_fixture.contact_id = client_contacts.contact_id
    where client_contacts.is_primary
      and client_contacts.role = 'primary'
      and client_contacts.deleted_at is null
  ),
  'convert_lead promotes an existing non-primary link to primary'
);

select ok(
  exists (
    select 1
    from public.client_contacts
    join _link_fixture
      on _link_fixture.client_id = client_contacts.client_id
     and _link_fixture.prior_primary_contact_id = client_contacts.contact_id
    where client_contacts.deleted_at is null
      and client_contacts.is_primary = false
      and client_contacts.role <> 'primary'
  ),
  'convert_lead demotes prior primary with is_primary and role kept consistent'
);

select ok(
  (
    select version > f.contact_version
    from public.contacts
    join _link_fixture f on f.contact_id = contacts.id
  ),
  'convert_lead bumps the lead contact version when primary link changes'
);

select ok(
  (
    select version > f.prior_primary_version
    from public.contacts
    join _link_fixture f on f.prior_primary_contact_id = contacts.id
  ),
  'convert_lead bumps the displaced prior-primary contact version'
);

update _link_fixture
set
  contact_version = (select version from public.contacts where id = contact_id),
  prior_primary_version = (
    select version from public.contacts where id = prior_primary_contact_id
  );

-- Corrupt primary after conversion; idempotent retry must repair it.
update public.client_contacts
set
  is_primary = false,
  role = 'billing'
where client_id = (select client_id from _link_fixture)
  and contact_id = (select contact_id from _link_fixture);

update public.client_contacts
set
  is_primary = true,
  role = 'primary'
where client_id = (select client_id from _link_fixture)
  and contact_id = (select prior_primary_contact_id from _link_fixture);

select pg_temp.as_user((select owner_id from _link_fixture));
set local role authenticated;

select ok(
  (
    select (public.convert_lead(lead_id) ->> 'idempotent')::boolean
    from _link_fixture
  ),
  'convert_lead idempotent retry returns idempotent=true for a won lead'
);

reset role;

select ok(
  exists (
    select 1
    from public.client_contacts
    join _link_fixture
      on _link_fixture.client_id = client_contacts.client_id
     and _link_fixture.contact_id = client_contacts.contact_id
    where client_contacts.is_primary
      and client_contacts.role = 'primary'
      and client_contacts.deleted_at is null
  )
  and exists (
    select 1
    from public.client_contacts
    join _link_fixture
      on _link_fixture.client_id = client_contacts.client_id
     and _link_fixture.prior_primary_contact_id = client_contacts.contact_id
    where client_contacts.deleted_at is null
      and client_contacts.is_primary = false
      and client_contacts.role <> 'primary'
  ),
  'idempotent convert_lead repairs/confirms the intended primary relation'
);

-- Soft-deleted contact on an already-won lead must fail idempotent retry.
update public.contacts
set deleted_at = now()
where id = (select contact_id from _link_fixture);

select pg_temp.as_user((select owner_id from _link_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.convert_lead((select lead_id from _link_fixture))
  $$,
  '22023',
  null,
  'idempotent convert_lead rejects a soft-deleted lead contact'
);

reset role;

select * from finish();

rollback;

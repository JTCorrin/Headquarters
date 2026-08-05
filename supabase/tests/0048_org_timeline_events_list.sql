begin;

select plan(9);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'timeline_events_org_occurred_idx'
  ),
  'timeline_events_org_occurred_idx exists'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.list_org_timeline_events(uuid, integer, timestamptz, uuid)',
    'execute'
  ),
  'authenticated can execute list_org_timeline_events'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.list_org_timeline_events(uuid, integer, timestamptz, uuid)',
    'execute'
  ),
  'anon cannot execute list_org_timeline_events'
);

create temporary table _org_tl_fixture (
  owner_id uuid,
  billing_id uuid,
  org_id uuid,
  client_id uuid,
  lead_id uuid,
  contact_id uuid,
  quote_id uuid,
  note_id uuid,
  page1_ids uuid[],
  page2_ids uuid[]
) on commit drop;

grant all on table _org_tl_fixture to authenticated;

create or replace function pg_temp.make_auth_user(p_email text, p_name text)
returns uuid
language plpgsql
as $$
declare
  created_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    created_id, 'authenticated', 'authenticated', p_email,
    extensions.crypt('org-tl-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('display_name', p_name),
    now(), now(), '', '', '', ''
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

insert into _org_tl_fixture (owner_id, billing_id)
values (
  pg_temp.make_auth_user('org-tl-owner@example.test', 'Org TL Owner'),
  pg_temp.make_auth_user('org-tl-billing@example.test', 'Org TL Billing')
);

select pg_temp.as_user((select owner_id from _org_tl_fixture));

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency, timezone)
  values (
    'Org TL Org',
    'orgtl-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP',
    'UTC'
  )
  returning id
)
update _org_tl_fixture set org_id = created_org.id from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _org_tl_fixture;

insert into public.memberships (org_id, user_id, role, status)
select org_id, billing_id, 'billing', 'active' from _org_tl_fixture;

with created_contact as (
  insert into public.contacts (
    org_id, display_name, primary_email, lifecycle_status, created_by, updated_by
  )
  select org_id, 'Org TL Contact', 'org-tl@example.test', 'active', owner_id, owner_id
  from _org_tl_fixture
  returning id
)
update _org_tl_fixture set contact_id = created_contact.id from created_contact;

with created_client as (
  insert into public.clients (org_id, name, status, created_by, updated_by)
  select org_id, 'Org TL Client', 'active', owner_id, owner_id
  from _org_tl_fixture
  returning id
)
update _org_tl_fixture set client_id = created_client.id from created_client;

with created_lead as (
  insert into public.leads (
    org_id, name, stage, currency, contact_id, created_by, updated_by
  )
  select org_id, 'Org TL Lead', 'qualified', 'GBP', contact_id, owner_id, owner_id
  from _org_tl_fixture
  returning id
)
update _org_tl_fixture set lead_id = created_lead.id from created_lead;

set local role authenticated;

with created as (
  select public.create_quote_draft(
    (select org_id from _org_tl_fixture),
    jsonb_build_object(
      'title', 'Org TL Quote',
      'client_id', (select client_id from _org_tl_fixture),
      'currency', 'GBP'
    ),
    '[]'::jsonb
  ) as doc
)
update _org_tl_fixture
set quote_id = (doc -> 'quote' ->> 'id')::uuid
from created;

with note as (
  select public.create_timeline_event(
    (select org_id from _org_tl_fixture),
    'contact',
    (select contact_id from _org_tl_fixture),
    'note',
    'Composer note',
    null,
    '{}'::jsonb
  ) as row
)
update _org_tl_fixture set note_id = (row).id from note;

reset role;

-- Lead conversion card (billing must not see via RLS). Insert as table owner.
insert into public.timeline_events (
  org_id, entity_type, entity_id, kind, title, actor_type, actor_id,
  source_type, source_id, payload, occurred_at
)
select
  org_id, 'lead', lead_id, 'conversion', 'Lead converted',
  'user', owner_id, 'lead', lead_id,
  jsonb_build_object('action', 'lead.converted'),
  now() - interval '1 minute'
from _org_tl_fixture;

select pg_temp.as_user((select owner_id from _org_tl_fixture));
set local role authenticated;

select is(
  (
    select count(*)::integer
    from public.timeline_events
    where org_id = (select org_id from _org_tl_fixture)
      and payload->>'action' = 'quote.created'
  ),
  2,
  'fixture has quote.created fan-out (quote + client)'
);

select is(
  (
    select count(*)::integer
    from public.list_org_timeline_events(
      (select org_id from _org_tl_fixture),
      50,
      null,
      null
    )
    where payload->>'action' = 'quote.created'
  ),
  1,
  'primary-rail list keeps one quote.created (drops client/lead mirrors)'
);

select ok(
  exists (
    select 1
    from public.list_org_timeline_events(
      (select org_id from _org_tl_fixture),
      50,
      null,
      null
    )
    where id = (select note_id from _org_tl_fixture)
  ),
  'primary-rail list keeps composer notes (source_type null)'
);

select ok(
  exists (
    select 1
    from public.list_org_timeline_events(
      (select org_id from _org_tl_fixture),
      50,
      null,
      null
    )
    where kind = 'conversion' and entity_type = 'lead'
  ),
  'owner list includes lead conversion cards'
);

reset role;
select pg_temp.as_user((select billing_id from _org_tl_fixture));
set local role authenticated;

select is(
  (
    select count(*)::integer
    from public.list_org_timeline_events(
      (select org_id from _org_tl_fixture),
      50,
      null,
      null
    )
    where kind = 'conversion' or entity_type = 'lead' or source_type = 'lead'
  ),
  0,
  'billing list omits lead/conversion rows via RLS'
);

reset role;
select pg_temp.as_user((select owner_id from _org_tl_fixture));
set local role authenticated;

-- Cursor: first page of 1, then next page continues
with page1 as (
  select array_agg(id order by occurred_at desc, id desc) as ids
  from (
    select id, occurred_at
    from public.list_org_timeline_events(
      (select org_id from _org_tl_fixture),
      1,
      null,
      null
    )
  ) first
)
update _org_tl_fixture set page1_ids = page1.ids from page1;

with cursor_row as (
  select occurred_at, id
  from public.timeline_events
  where id = (select page1_ids[1] from _org_tl_fixture)
),
page2 as (
  select array_agg(te.id) as ids
  from public.list_org_timeline_events(
    (select org_id from _org_tl_fixture),
    50,
    (select occurred_at from cursor_row),
    (select id from cursor_row)
  ) te
)
update _org_tl_fixture set page2_ids = page2.ids from page2;

select ok(
  (
    select cardinality(page1_ids) = 1
      and page2_ids is not null
      and not (page1_ids[1] = any (page2_ids))
    from _org_tl_fixture
  ),
  'keyset cursor pages without repeating the first row'
);

select * from finish();
rollback;

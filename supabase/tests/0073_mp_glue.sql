begin;

select plan(8);

create temporary table _mp_glue_fixture (
  owner_id uuid,
  org_id uuid,
  client_id uuid,
  meeting_id uuid,
  proposal_id uuid,
  accepted_task_id uuid
) on commit drop;

grant all on table _mp_glue_fixture to authenticated;

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
    extensions.crypt('mp-glue-password', extensions.gen_salt('bf')),
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

insert into _mp_glue_fixture (owner_id)
values (pg_temp.make_auth_user('mp-glue-owner@example.test', 'MP Glue Owner'));

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency, timezone)
  values (
    'MP Glue Org',
    'mp-glue-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP',
    'UTC'
  )
  returning id
)
update _mp_glue_fixture
set org_id = created_org.id
from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _mp_glue_fixture;

with created_client as (
  insert into public.clients (org_id, name, status, created_by, updated_by)
  select org_id, 'MP Glue Client', 'active', owner_id, owner_id
  from _mp_glue_fixture
  returning id
)
update _mp_glue_fixture
set client_id = created_client.id
from created_client;

select pg_temp.as_user((select owner_id from _mp_glue_fixture));
set local role authenticated;

with meeting as (
  insert into public.meetings (
    org_id,
    title,
    starts_at,
    ends_at,
    timezone,
    related_entity_type,
    related_entity_id,
    created_by,
    updated_by
  )
  select
    org_id,
    'MP Glue standup',
    now() + interval '1 day',
    now() + interval '1 day 1 hour',
    'UTC',
    'client',
    client_id,
    owner_id,
    owner_id
  from _mp_glue_fixture
  returning id
)
update _mp_glue_fixture
set meeting_id = meeting.id
from meeting;

select is(
  (
    select count(*)::integer
    from public.timeline_events
    where org_id = (select org_id from _mp_glue_fixture)
      and entity_type = 'client'
      and entity_id = (select client_id from _mp_glue_fixture)
      and kind = 'meeting'
      and payload ->> 'action' = 'meeting.scheduled'
  ),
  1,
  'meeting create with related client writes meeting.scheduled timeline card'
);

-- Accept while the meeting is still non-terminal (scheduled / in_progress).
with proposal as (
  insert into public.meeting_task_proposals (
    org_id, meeting_id, title, description, confidence, status
  )
  select
    org_id,
    meeting_id,
    'Follow up with client',
    'From MP-Glue',
    0.9100,
    'proposed'
  from _mp_glue_fixture
  returning id
)
update _mp_glue_fixture
set proposal_id = proposal.id
from proposal;

with accepted as (
  select public.accept_meeting_task_proposal(
    (select org_id from _mp_glue_fixture),
    (select meeting_id from _mp_glue_fixture),
    (select proposal_id from _mp_glue_fixture)
  ) as body
)
update _mp_glue_fixture
set accepted_task_id = (accepted.body ->> 'accepted_task_id')::uuid
from accepted;

select is(
  (
    select entity_type from public.tasks
    where id = (select accepted_task_id from _mp_glue_fixture)
  ),
  'client',
  'accept inherits meeting related_entity_type onto task'
);

select ok(
  (
    select assignee_membership_id is not null
    from public.tasks
    where id = (select accepted_task_id from _mp_glue_fixture)
  ),
  'accept assigns created task to accepting member when proposal has no suggestion'
);

select is(
  (
    select entity_id from public.tasks
    where id = (select accepted_task_id from _mp_glue_fixture)
  ),
  (select client_id from _mp_glue_fixture),
  'accept inherits meeting related_entity_id onto task'
);

select is(
  (
    select count(*)::integer
    from public.timeline_events
    where org_id = (select org_id from _mp_glue_fixture)
      and entity_type = 'client'
      and entity_id = (select client_id from _mp_glue_fixture)
      and kind = 'task'
      and payload ->> 'action' = 'meeting.task_accepted'
      and (payload ->> 'task_id')::uuid = (select accepted_task_id from _mp_glue_fixture)
  ),
  1,
  'accept writes task timeline card on related entity'
);

update public.meetings
set status = 'completed'
where id = (select meeting_id from _mp_glue_fixture);

select is(
  (
    select count(*)::integer
    from public.timeline_events
    where org_id = (select org_id from _mp_glue_fixture)
      and entity_type = 'client'
      and entity_id = (select client_id from _mp_glue_fixture)
      and kind = 'meeting'
      and payload ->> 'action' = 'meeting.completed'
  ),
  1,
  'meeting completed writes meeting.completed timeline card'
);

with created_project as (
  insert into public.projects (
    org_id, client_id, name, status, created_by, updated_by
  )
  select org_id, client_id, 'MP Glue Project', 'active', owner_id, owner_id
  from _mp_glue_fixture
  returning id
)
insert into public.tasks (
  org_id, title, source, entity_type, entity_id, status, priority, created_by, updated_by
)
select
  f.org_id,
  'Manual project-linked',
  'manual',
  'project',
  created_project.id,
  'open',
  'p3',
  f.owner_id,
  f.owner_id
from _mp_glue_fixture f
cross join created_project;

select is(
  (
    select count(*)::integer
    from public.tasks
    where org_id = (select org_id from _mp_glue_fixture)
      and entity_type = 'project'
      and title = 'Manual project-linked'
      and deleted_at is null
  ),
  1,
  'task entity_type=project validates against live project'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'tasks_org_project_card_idx'
  ),
  'tasks_org_project_card_idx exists for list filter'
);

select * from finish();
rollback;

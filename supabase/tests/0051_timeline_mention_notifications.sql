begin;

select plan(6);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_notifications'
      and column_name = 'payload'
  ),
  'user_notifications.payload column exists'
);

create temporary table _mention_fixture (
  owner_id uuid,
  member_id uuid,
  org_id uuid,
  owner_membership_id uuid,
  member_membership_id uuid,
  client_id uuid,
  event_id uuid
) on commit drop;

grant all on table _mention_fixture to authenticated;

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
    extensions.crypt('mention-password', extensions.gen_salt('bf')),
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

insert into _mention_fixture (owner_id, member_id)
values (
  pg_temp.make_auth_user('mention-owner@example.test', 'Mention Owner'),
  pg_temp.make_auth_user('mention-member@example.test', 'Mention Member')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Mention Org',
    'mention-org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
)
update _mention_fixture
set org_id = created_org.id
from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _mention_fixture;

insert into public.memberships (org_id, user_id, role, status)
select org_id, member_id, 'member', 'active' from _mention_fixture;

update _mention_fixture
set
  owner_membership_id = (
    select m.id from public.memberships m
    where m.org_id = _mention_fixture.org_id
      and m.user_id = _mention_fixture.owner_id
  ),
  member_membership_id = (
    select m.id from public.memberships m
    where m.org_id = _mention_fixture.org_id
      and m.user_id = _mention_fixture.member_id
  );

with created_client as (
  insert into public.clients (org_id, name, status, created_by, updated_by)
  select org_id, 'Mention Client', 'active', owner_id, owner_id
  from _mention_fixture
  returning id
)
update _mention_fixture
set client_id = created_client.id
from created_client;

select pg_temp.as_user((select owner_id from _mention_fixture));
set local role authenticated;

with created as (
  select public.create_timeline_event(
    (select org_id from _mention_fixture),
    'client',
    (select client_id from _mention_fixture),
    'note',
    'Follow up',
    'Please see @Mention Member',
    jsonb_build_object(
      'mentions',
      jsonb_build_array(
        jsonb_build_object(
          'membership_id', (select member_membership_id from _mention_fixture),
          'display_name', 'Mention Member'
        ),
        jsonb_build_object(
          'membership_id', (select owner_membership_id from _mention_fixture),
          'display_name', 'Mention Owner'
        ),
        jsonb_build_object(
          'membership_id', (select member_membership_id from _mention_fixture),
          'display_name', 'Mention Member'
        )
      )
    )
  ) as row
)
update _mention_fixture
set event_id = (created.row).id
from created;

select is(
  (
    select count(*)::integer
    from public.user_notifications n
    where n.org_id = (select org_id from _mention_fixture)
      and n.kind = 'timeline.mention'
      and n.source_type = 'timeline_event'
      and n.source_id = (select event_id from _mention_fixture)
  ),
  1,
  'mention fan-out creates one notification (dedupe + skip self)'
);

select is(
  (
    select n.recipient_membership_id
    from public.user_notifications n
    where n.source_id = (select event_id from _mention_fixture)
      and n.kind = 'timeline.mention'
  ),
  (select member_membership_id from _mention_fixture),
  'notification goes to mentioned member'
);

select is(
  (
    select n.payload ->> 'entity_type'
    from public.user_notifications n
    where n.source_id = (select event_id from _mention_fixture)
      and n.kind = 'timeline.mention'
  ),
  'client',
  'notification payload includes entity_type for deep-link'
);

select pg_temp.as_user((select member_id from _mention_fixture));

select is(
  public.count_my_unread_notifications((select org_id from _mention_fixture)),
  1,
  'mentioned member unread count is 1'
);

select is(
  (
    select jsonb_array_length(
      public.list_my_notifications((select org_id from _mention_fixture), 50, null, null)
    )
  ),
  1,
  'mentioned member lists the timeline.mention notification'
);

select * from finish();
rollback;

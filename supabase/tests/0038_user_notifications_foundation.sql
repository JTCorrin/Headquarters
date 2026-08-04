begin;

select plan(18);

select ok(
  exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'user_notifications'
  ),
  'user_notifications table exists'
);

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.user_notifications'::regclass
  ),
  'user_notifications has RLS enabled'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.create_user_notification(uuid, uuid, text, text, uuid, text, text)',
    'execute'
  ),
  'authenticated cannot call private.create_user_notification'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.list_my_notifications(uuid, integer, timestamptz, uuid)',
    'execute'
  ),
  'authenticated can execute list_my_notifications'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.mark_notification_read(uuid, uuid)',
    'execute'
  ),
  'authenticated can execute mark_notification_read'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.count_my_unread_notifications(uuid)',
    'execute'
  ),
  'authenticated can execute count_my_unread_notifications'
);

select ok(
  not exists (
    select 1
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'user_notifications'
      and grantee = 'authenticated'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ),
  'authenticated cannot mutate user_notifications directly'
);

select ok(
  has_table_privilege('authenticated', 'public.user_notifications', 'select'),
  'authenticated can select user_notifications (RLS applies)'
);

create temporary table _notif_fixture (
  owner_id uuid,
  member_id uuid,
  org_id uuid,
  owner_membership_id uuid,
  member_membership_id uuid,
  mailbox_id uuid,
  message_id uuid,
  notification_id uuid
) on commit drop;

grant all on table _notif_fixture to authenticated;

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
    extensions.crypt('notif-foundation-password', extensions.gen_salt('bf')),
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

insert into _notif_fixture (owner_id, member_id)
values (
  pg_temp.make_auth_user('notif-owner@example.test', 'Notif Owner'),
  pg_temp.make_auth_user('notif-member@example.test', 'Notif Member')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Notif Org',
    'notif-org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
)
update _notif_fixture
set org_id = created_org.id
from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _notif_fixture;

insert into public.memberships (org_id, user_id, role, status)
select org_id, member_id, 'member', 'active' from _notif_fixture;

update _notif_fixture
set
  owner_membership_id = (
    select m.id from public.memberships m
    where m.org_id = _notif_fixture.org_id
      and m.user_id = _notif_fixture.owner_id
  ),
  member_membership_id = (
    select m.id from public.memberships m
    where m.org_id = _notif_fixture.org_id
      and m.user_id = _notif_fixture.member_id
  );

with created_mailbox as (
  insert into public.mailbox_accounts (
    org_id, membership_id, email_address, from_name,
    imap_host, imap_port, imap_security,
    smtp_host, smtp_port, smtp_security,
    username, status, created_by, updated_by
  )
  select
    org_id, owner_membership_id, 'notif-owner@example.test', 'Owner',
    'imap.example.test', 993, 'tls',
    'smtp.example.test', 587, 'starttls',
    'notif-owner@example.test', 'active', owner_id, owner_id
  from _notif_fixture
  returning id
)
update _notif_fixture
set mailbox_id = created_mailbox.id
from created_mailbox;

-- New inbound creates one notification for mailbox owner.
do $$
declare
  f _notif_fixture%rowtype;
  upserted jsonb;
begin
  select * into f from _notif_fixture;
  upserted := public.upsert_inbound_email_message(
    f.org_id,
    f.mailbox_id,
    'provider-msg-1',
    'provider-thread-1',
    'client@example.test',
    'Client',
    '[{"email":"notif-owner@example.test"}]'::jsonb,
    'New Email Received',
    'Hello body',
    'Hello preview',
    now(),
    false
  );
  update _notif_fixture
  set message_id = (upserted ->> 'id')::uuid;
end;
$$;

select is(
  (
    select count(*)::integer
    from public.user_notifications n
    join _notif_fixture f on f.org_id = n.org_id
    where n.source_id = f.message_id
      and n.kind = 'email.received'
      and n.recipient_membership_id = f.owner_membership_id
  ),
  1,
  'new inbound email creates one email.received notification for mailbox owner'
);

-- Re-sync same provider id does not duplicate.
do $$
declare
  f _notif_fixture%rowtype;
begin
  select * into f from _notif_fixture;
  perform public.upsert_inbound_email_message(
    f.org_id,
    f.mailbox_id,
    'provider-msg-1',
    'provider-thread-1',
    'client@example.test',
    'Client',
    '[{"email":"notif-owner@example.test"}]'::jsonb,
    'New Email Received (updated)',
    'Hello body updated',
    'Hello preview updated',
    now(),
    false
  );
end;
$$;

select is(
  (
    select count(*)::integer
    from public.user_notifications n
    join _notif_fixture f on f.org_id = n.org_id
    where n.source_id = f.message_id
      and n.kind = 'email.received'
  ),
  1,
  're-sync upsert does not duplicate notifications'
);

select is(
  (
    select count(*)::integer
    from public.user_notifications n
    join _notif_fixture f on true
    where n.org_id = f.org_id
      and n.recipient_membership_id = f.member_membership_id
  ),
  0,
  'non-owner member does not receive mailbox owner inbound notification'
);

update _notif_fixture
set notification_id = n.id
from public.user_notifications n
where n.org_id = _notif_fixture.org_id
  and n.source_id = _notif_fixture.message_id;

-- Owner list / unread / mark-read
select pg_temp.as_user((select owner_id from _notif_fixture));
set local role authenticated;

select is(
  public.count_my_unread_notifications((select org_id from _notif_fixture)),
  1,
  'owner unread count is 1 after inbound'
);

select is(
  (
    select jsonb_array_length(
      public.list_my_notifications((select org_id from _notif_fixture), 50, null, null)
    )
  ),
  1,
  'owner list_my_notifications returns one row'
);

select lives_ok(
  $$
    select public.mark_notification_read(
      (select org_id from _notif_fixture),
      (select notification_id from _notif_fixture)
    )
  $$,
  'owner can mark notification read'
);

select is(
  public.count_my_unread_notifications((select org_id from _notif_fixture)),
  0,
  'owner unread count is 0 after mark-read'
);

select isnt_empty(
  $$
    select id from public.user_notifications
    where id = (select notification_id from _notif_fixture)
  $$,
  'owner can SELECT own notification via RLS'
);

-- Member cannot see owner's notification via RLS or list RPC.
reset role;
select pg_temp.as_user((select member_id from _notif_fixture));
set local role authenticated;

select is_empty(
  $$
    select id from public.user_notifications
    where id = (select notification_id from _notif_fixture)
  $$,
  'member cannot SELECT owner notification via RLS'
);

select is(
  (
    select jsonb_array_length(
      public.list_my_notifications((select org_id from _notif_fixture), 50, null, null)
    )
  ),
  0,
  'member list_my_notifications is empty for owner mailbox inbound'
);

select * from finish();
rollback;

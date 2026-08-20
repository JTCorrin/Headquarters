begin;

select plan(19);

select has_column(
  'public',
  'mailbox_accounts',
  'sync_interval_minutes',
  'mailbox_accounts.sync_interval_minutes exists'
);

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.mailbox_accounts'::regclass
  ),
  'mailbox_accounts RLS remains enabled'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.update_mailbox_sync_interval(uuid, integer)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.update_mailbox_sync_interval(uuid, integer)',
    'execute'
  ),
  'only authenticated can execute update_mailbox_sync_interval'
);

select ok(
  has_column_privilege(
    'authenticated',
    'public.mailbox_accounts',
    'sync_interval_minutes',
    'select'
  ),
  'authenticated can select sync_interval_minutes'
);

create temporary table _mailbox_sync_interval_fixture (
  owner_id uuid,
  admin_id uuid,
  member_id uuid,
  readonly_id uuid,
  missing_mailbox_id uuid,
  org_id uuid,
  owner_membership_id uuid,
  admin_membership_id uuid,
  member_membership_id uuid,
  owner_mailbox_id uuid,
  admin_mailbox_id uuid,
  member_mailbox_id uuid
) on commit drop;

grant all on table _mailbox_sync_interval_fixture to authenticated;

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
    created_id,
    'authenticated',
    'authenticated',
    p_email,
    extensions.crypt('mailbox-sync-interval-fixture', extensions.gen_salt('bf')),
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
  perform set_config('request.jwt.claim.sub', coalesce(p_user_id::text, ''), true);
  perform set_config(
    'request.jwt.claim.role',
    case when p_user_id is null then '' else 'authenticated' end,
    true
  );
  perform set_config(
    'request.jwt.claims',
    case
      when p_user_id is null then ''
      else json_build_object(
        'sub', p_user_id::text,
        'role', 'authenticated'
      )::text
    end,
    true
  );
end;
$$;

grant execute on function pg_temp.as_user(uuid) to authenticated;

insert into _mailbox_sync_interval_fixture (
  owner_id,
  admin_id,
  member_id,
  readonly_id,
  missing_mailbox_id
)
values (
  pg_temp.make_auth_user('sync-interval-owner@example.test', 'Sync Interval Owner'),
  pg_temp.make_auth_user('sync-interval-admin@example.test', 'Sync Interval Admin'),
  pg_temp.make_auth_user('sync-interval-member@example.test', 'Sync Interval Member'),
  pg_temp.make_auth_user('sync-interval-readonly@example.test', 'Sync Interval Readonly'),
  pg_temp.make_auth_user('sync-interval-missing@example.test', 'Sync Interval Missing')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Mailbox Sync Interval Org',
    'mailbox-sync-interval-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
)
update _mailbox_sync_interval_fixture
set org_id = created_org.id
from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active'
from _mailbox_sync_interval_fixture
union all
select org_id, admin_id, 'admin', 'active'
from _mailbox_sync_interval_fixture
union all
select org_id, member_id, 'member', 'active'
from _mailbox_sync_interval_fixture
union all
select org_id, readonly_id, 'readonly', 'active'
from _mailbox_sync_interval_fixture
union all
select org_id, missing_mailbox_id, 'admin', 'active'
from _mailbox_sync_interval_fixture;

update _mailbox_sync_interval_fixture f
set
  owner_membership_id = owner_membership.id,
  admin_membership_id = admin_membership.id,
  member_membership_id = member_membership.id
from public.memberships owner_membership,
     public.memberships admin_membership,
     public.memberships member_membership
where owner_membership.org_id = f.org_id
  and owner_membership.user_id = f.owner_id
  and admin_membership.org_id = f.org_id
  and admin_membership.user_id = f.admin_id
  and member_membership.org_id = f.org_id
  and member_membership.user_id = f.member_id;

with inserted as (
  insert into public.mailbox_accounts (
    org_id,
    membership_id,
    email_address,
    imap_host,
    imap_port,
    imap_security,
    smtp_host,
    smtp_port,
    smtp_security,
    username,
    secret_ref,
    status,
    last_checked_at,
    sync_catchup_complete
  )
  select
    org_id,
    owner_membership_id,
    'sync-interval-owner@example.test',
    'imap.example.test',
    993,
    'tls',
    'smtp.example.test',
    587,
    'starttls',
    'sync-interval-owner@example.test',
    gen_random_uuid(),
    'active',
    now() - interval '6 minutes',
    true
  from _mailbox_sync_interval_fixture
  returning id
)
update _mailbox_sync_interval_fixture
set owner_mailbox_id = inserted.id
from inserted;

select is(
  (
    select sync_interval_minutes
    from public.mailbox_accounts
    where id = (select owner_mailbox_id from _mailbox_sync_interval_fixture)
  ),
  5,
  'new mailboxes default to a five minute sync interval'
);

select throws_ok(
  $$
    update public.mailbox_accounts
    set sync_interval_minutes = 0
    where id = (select owner_mailbox_id from _mailbox_sync_interval_fixture)
  $$,
  '23514',
  null,
  'sync interval rejects values below one minute'
);

select throws_ok(
  $$
    update public.mailbox_accounts
    set sync_interval_minutes = 61
    where id = (select owner_mailbox_id from _mailbox_sync_interval_fixture)
  $$,
  '23514',
  null,
  'sync interval rejects values above sixty minutes'
);

update public.mailbox_accounts
set sync_interval_minutes = 10
where id = (select owner_mailbox_id from _mailbox_sync_interval_fixture);

with inserted as (
  insert into public.mailbox_accounts (
    org_id,
    membership_id,
    email_address,
    imap_host,
    imap_port,
    imap_security,
    smtp_host,
    smtp_port,
    smtp_security,
    username,
    secret_ref,
    status,
    last_checked_at,
    sync_catchup_complete
  )
  select
    org_id,
    admin_membership_id,
    'sync-interval-admin@example.test',
    'imap.example.test',
    993,
    'tls',
    'smtp.example.test',
    587,
    'starttls',
    'sync-interval-admin@example.test',
    gen_random_uuid(),
    'active',
    now() - interval '6 minutes',
    true
  from _mailbox_sync_interval_fixture
  returning id
)
update _mailbox_sync_interval_fixture
set admin_mailbox_id = inserted.id
from inserted;

with inserted as (
  insert into public.mailbox_accounts (
    org_id,
    membership_id,
    email_address,
    imap_host,
    imap_port,
    imap_security,
    smtp_host,
    smtp_port,
    smtp_security,
    username,
    secret_ref,
    status,
    last_checked_at,
    sync_catchup_complete,
    sync_interval_minutes
  )
  select
    org_id,
    member_membership_id,
    'sync-interval-member@example.test',
    'imap.example.test',
    993,
    'tls',
    'smtp.example.test',
    587,
    'starttls',
    'sync-interval-member@example.test',
    gen_random_uuid(),
    'active',
    now(),
    false,
    60
  from _mailbox_sync_interval_fixture
  returning id
)
update _mailbox_sync_interval_fixture
set member_mailbox_id = inserted.id
from inserted;

update public.mailbox_accounts
set last_checked_at = null
where id = (select owner_mailbox_id from _mailbox_sync_interval_fixture);

select ok(
  public.list_mailboxes_due_for_sync(100) @> jsonb_build_array(
    jsonb_build_object('id', (select owner_mailbox_id from _mailbox_sync_interval_fixture))
  ),
  'mailbox with no previous check is immediately due'
);

update public.mailbox_accounts
set last_checked_at = now() - interval '6 minutes'
where id = (select owner_mailbox_id from _mailbox_sync_interval_fixture);

select ok(
  public.list_mailboxes_due_for_sync(100) @> jsonb_build_array(
    jsonb_build_object('id', (select admin_mailbox_id from _mailbox_sync_interval_fixture))
  ),
  'completed mailbox is due after its configured interval'
);

select ok(
  not public.list_mailboxes_due_for_sync(100) @> jsonb_build_array(
    jsonb_build_object('id', (select owner_mailbox_id from _mailbox_sync_interval_fixture))
  ),
  'completed mailbox is not due before its configured interval'
);

select ok(
  public.list_mailboxes_due_for_sync(100) @> jsonb_build_array(
    jsonb_build_object('id', (select member_mailbox_id from _mailbox_sync_interval_fixture))
  ),
  'incomplete catch-up bypasses the configured interval'
);

select pg_temp.as_user((select owner_id from _mailbox_sync_interval_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.update_mailbox_sync_interval(
      (select org_id from _mailbox_sync_interval_fixture),
      0
    )
  $$,
  '22023',
  'Sync interval must be between 1 and 60 minutes',
  'update RPC validates the requested sync interval'
);

select is(
  (
    public.update_mailbox_sync_interval(
      (select org_id from _mailbox_sync_interval_fixture),
      12
    ) ->> 'sync_interval_minutes'
  )::integer,
  12,
  'owner can update their own mailbox sync interval'
);

select ok(
  not (
    public.update_mailbox_sync_interval(
      (select org_id from _mailbox_sync_interval_fixture),
      12
    ) ?| array['secret_ref', 'password', 'token_blob']
  ),
  'update RPC does not expose mailbox secrets'
);

reset role;

select is(
  (
    select sync_interval_minutes
    from public.mailbox_accounts
    where id = (select member_mailbox_id from _mailbox_sync_interval_fixture)
  ),
  60,
  'owner update does not modify another membership mailbox'
);

select pg_temp.as_user((select member_id from _mailbox_sync_interval_fixture));
set local role authenticated;

select is(
  (
    public.update_mailbox_sync_interval(
      (select org_id from _mailbox_sync_interval_fixture),
      30
    ) ->> 'sync_interval_minutes'
  )::integer,
  30,
  'member can update their own mailbox sync interval'
);

reset role;
select pg_temp.as_user((select readonly_id from _mailbox_sync_interval_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.update_mailbox_sync_interval(
      (select org_id from _mailbox_sync_interval_fixture),
      15
    )
  $$,
  '42501',
  'Forbidden',
  'readonly membership cannot update a mailbox sync interval'
);

reset role;
select pg_temp.as_user((select missing_mailbox_id from _mailbox_sync_interval_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.update_mailbox_sync_interval(
      (select org_id from _mailbox_sync_interval_fixture),
      15
    )
  $$,
  'P0002',
  'Mailbox not found',
  'RPC rejects an active allowed membership without a mailbox'
);

reset role;
select pg_temp.as_user(null);
set local role authenticated;

select throws_ok(
  $$
    select public.update_mailbox_sync_interval(
      (select org_id from _mailbox_sync_interval_fixture),
      15
    )
  $$,
  '42501',
  'Authentication is required',
  'RPC requires an authenticated user'
);

select * from finish();
rollback;

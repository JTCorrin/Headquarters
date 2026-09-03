begin;

select plan(12);

create temporary table _campaign_fixture (
  owner_id uuid,
  org_id uuid,
  tag_id uuid,
  tag_b_id uuid,
  contact_id uuid,
  lead_id uuid,
  client_id uuid,
  membership_id uuid,
  mailbox_id uuid,
  template_id uuid,
  campaign_id uuid
) on commit drop;

grant all on table _campaign_fixture to authenticated;

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
    extensions.crypt('campaign-test-password', extensions.gen_salt('bf')),
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

insert into _campaign_fixture (owner_id)
values (pg_temp.make_auth_user('campaign-owner@example.test', 'Campaign Owner'));

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency, timezone)
  values (
    'Campaign Test Org',
    'campaign-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP',
    'UTC'
  )
  returning id
)
update _campaign_fixture
set org_id = created_org.id
from created_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _campaign_fixture;

update _campaign_fixture f
set membership_id = m.id
from public.memberships m
where m.org_id = f.org_id and m.user_id = f.owner_id;

-- Fixture rows as postgres (bypasses mailbox insert grants).
with created_tag as (
  insert into public.tags (org_id, name, color, created_by, updated_by)
  select org_id, 'Newsletter', 'blue', owner_id, owner_id from _campaign_fixture
  returning id
)
update _campaign_fixture set tag_id = created_tag.id from created_tag;

with created_tag_b as (
  insert into public.tags (org_id, name, created_by, updated_by)
  select org_id, 'Partners', owner_id, owner_id from _campaign_fixture
  returning id
)
update _campaign_fixture set tag_b_id = created_tag_b.id from created_tag_b;

with created_contact as (
  insert into public.contacts (
    org_id, display_name, primary_email, lifecycle_status, created_by, updated_by
  )
  select org_id, 'Ava Contact', 'ava@example.test', 'active', owner_id, owner_id
  from _campaign_fixture
  returning id
)
update _campaign_fixture set contact_id = created_contact.id from created_contact;

with created_lead as (
  insert into public.leads (
    org_id, name, primary_email, stage, created_by, updated_by
  )
  select org_id, 'Lead Dup', 'ava@example.test', 'new', owner_id, owner_id
  from _campaign_fixture
  returning id
)
update _campaign_fixture set lead_id = created_lead.id from created_lead;

with created_client as (
  insert into public.clients (
    org_id, name, primary_email, status, created_by, updated_by
  )
  select org_id, 'No Email Client', null, 'active', owner_id, owner_id
  from _campaign_fixture
  returning id
)
update _campaign_fixture set client_id = created_client.id from created_client;

with created_template as (
  insert into public.email_templates (
    org_id, name, subject, body_text, category, status, created_by, updated_by
  )
  select
    org_id,
    'Campaign Hello',
    'Hi {{contact.name}}',
    'Body for {{lead.name}}',
    'campaign',
    'active',
    owner_id,
    owner_id
  from _campaign_fixture
  returning id
)
update _campaign_fixture set template_id = created_template.id from created_template;

with created_mailbox as (
  insert into public.mailbox_accounts (
    org_id, membership_id, email_address, from_name,
    imap_host, imap_port, imap_security,
    smtp_host, smtp_port, smtp_security,
    username, status, created_by, updated_by
  )
  select
    org_id, membership_id, 'sender@example.test', 'Sender',
    'imap.example.test', 993, 'tls',
    'smtp.example.test', 587, 'starttls',
    'sender@example.test', 'active', owner_id, owner_id
  from _campaign_fixture
  returning id
)
update _campaign_fixture set mailbox_id = created_mailbox.id from created_mailbox;

with created_campaign as (
  insert into public.campaigns (
    org_id, name, status, template_id, mailbox_id, created_by, updated_by
  )
  select org_id, 'Spring Shot', 'draft', template_id, mailbox_id, owner_id, owner_id
  from _campaign_fixture
  returning id
)
update _campaign_fixture set campaign_id = created_campaign.id from created_campaign;

-- Authenticated actor for RPC/RLS checks
select pg_temp.as_user(owner_id) from _campaign_fixture;

select throws_ok(
  $$
    insert into public.tags (org_id, name)
    select org_id, 'newsletter' from _campaign_fixture
  $$,
  '23505',
  null,
  'tag names are unique per org case-insensitively'
);

select public.replace_entity_tags(
  (select org_id from _campaign_fixture),
  'contact',
  (select contact_id from _campaign_fixture),
  array[(select tag_id from _campaign_fixture)]
);

select public.replace_entity_tags(
  (select org_id from _campaign_fixture),
  'lead',
  (select lead_id from _campaign_fixture),
  array[(select tag_id from _campaign_fixture)]
);

select public.replace_entity_tags(
  (select org_id from _campaign_fixture),
  'client',
  (select client_id from _campaign_fixture),
  array[(select tag_id from _campaign_fixture)]
);

select is(
  (
    select count(*)::integer
    from public.resolve_campaign_audience(
      (select org_id from _campaign_fixture),
      array[(select tag_id from _campaign_fixture)],
      array['lead', 'contact', 'client']::text[],
      500
    )
  ),
  3,
  'audience resolve returns three tagged entities'
);

select is(
  (
    select count(*)::integer
    from public.resolve_campaign_audience(
      (select org_id from _campaign_fixture),
      array[(select tag_id from _campaign_fixture)],
      array['lead', 'contact', 'client']::text[],
      500
    ) r
    where r.skip_reason = 'duplicate_email'
  ),
  1,
  'duplicate email is skipped once'
);

select is(
  (
    select count(*)::integer
    from public.resolve_campaign_audience(
      (select org_id from _campaign_fixture),
      array[(select tag_id from _campaign_fixture)],
      array['lead', 'contact', 'client']::text[],
      500
    ) r
    where r.skip_reason = 'missing_email'
  ),
  1,
  'missing email is skipped'
);

select is(
  (
    select count(*)::integer
    from public.resolve_campaign_audience(
      (select org_id from _campaign_fixture),
      array[(select tag_id from _campaign_fixture)],
      array['lead', 'contact', 'client']::text[],
      500
    ) r
    where r.skip_reason is null
  ),
  1,
  'exactly one sendable recipient after dedupe'
);

select public.replace_campaign_audience(
  (select campaign_id from _campaign_fixture),
  (select org_id from _campaign_fixture),
  array[(select tag_id from _campaign_fixture)],
  array['lead', 'contact', 'client']::text[]
);

select lives_ok(
  $$
    select public.launch_campaign(
      (select campaign_id from _campaign_fixture),
      (select org_id from _campaign_fixture),
      (select version from public.campaigns where id = (select campaign_id from _campaign_fixture)),
      true
    )
  $$,
  'launch_campaign freezes recipients and starts sending'
);

select is(
  (select status from public.campaigns where id = (select campaign_id from _campaign_fixture)),
  'sending',
  'launched campaign is sending'
);

select is(
  (
    select count(*)::integer
    from public.campaign_recipients
    where campaign_id = (select campaign_id from _campaign_fixture)
      and status = 'pending'
  ),
  1,
  'launch creates one pending recipient'
);

select is(
  (
    select count(*)::integer
    from public.campaign_recipients
    where campaign_id = (select campaign_id from _campaign_fixture)
      and status = 'skipped'
  ),
  2,
  'launch marks skipped recipients'
);

select public.cancel_campaign(
  (select campaign_id from _campaign_fixture),
  (select org_id from _campaign_fixture),
  (select version from public.campaigns where id = (select campaign_id from _campaign_fixture))
);

select is(
  (select status from public.campaigns where id = (select campaign_id from _campaign_fixture)),
  'cancelled',
  'cancel_campaign sets cancelled'
);

select public.soft_delete_tag(
  (select tag_b_id from _campaign_fixture),
  (select org_id from _campaign_fixture),
  (select version from public.tags where id = (select tag_b_id from _campaign_fixture))
);

select is(
  (select deleted_at is not null from public.tags where id = (select tag_b_id from _campaign_fixture)),
  true,
  'soft_delete_tag sets deleted_at'
);

select finish();
rollback;

-- Incremental IMAP UID catch-up, MIME body_html/CC ingest, contact CC matching,
-- and client email_domain matching (plus client_contacts).

-- ---------------------------------------------------------------------------
-- mailbox_accounts: UID cursor
-- ---------------------------------------------------------------------------

alter table public.mailbox_accounts
  add column if not exists imap_uidvalidity bigint,
  add column if not exists sync_high_uid bigint,
  add column if not exists sync_low_uid bigint,
  add column if not exists sync_catchup_complete boolean not null default false;

alter table public.mailbox_accounts
  drop constraint if exists mailbox_accounts_sync_max_messages_check;

alter table public.mailbox_accounts
  add constraint mailbox_accounts_sync_max_messages_check
  check (sync_max_messages between 1 and 5000);

comment on column public.mailbox_accounts.imap_uidvalidity is
  'IMAP UIDVALIDITY from SELECT INBOX; reset high/low cursor when this changes.';
comment on column public.mailbox_accounts.sync_high_uid is
  'Highest INBOX UID ingested for this UIDVALIDITY.';
comment on column public.mailbox_accounts.sync_low_uid is
  'Lowest INBOX UID ingested while walking history downward.';
comment on column public.mailbox_accounts.sync_catchup_complete is
  'True once every current INBOX UID has been attempted for this UIDVALIDITY.';

grant select (
  imap_uidvalidity, sync_high_uid, sync_low_uid, sync_catchup_complete
) on table public.mailbox_accounts to authenticated;

-- ---------------------------------------------------------------------------
-- email_messages: imap_uid
-- ---------------------------------------------------------------------------

alter table public.email_messages
  add column if not exists imap_uid bigint;

create index if not exists email_messages_mailbox_imap_uid_idx
  on public.email_messages (mailbox_account_id, imap_uid)
  where deleted_at is null and imap_uid is not null;

create index if not exists email_messages_org_owner_from_idx
  on public.email_messages (org_id, owner_membership_id, from_address)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- clients.email_domain
-- ---------------------------------------------------------------------------

alter table public.clients
  add column if not exists email_domain extensions.citext;

comment on column public.clients.email_domain is
  'Mail-tab domain match (from/to/cc host). Auto-filled from primary_email when not a public mailbox domain.';

create index if not exists clients_org_email_domain_idx
  on public.clients (org_id, email_domain)
  where deleted_at is null and email_domain is not null;

grant insert (email_domain) on table public.clients to authenticated;
grant update (email_domain) on table public.clients to authenticated;

-- ---------------------------------------------------------------------------
-- email_message_links.link_reason: domain_match
-- ---------------------------------------------------------------------------

alter table public.email_message_links
  drop constraint if exists email_message_links_link_reason_check;

alter table public.email_message_links
  add constraint email_message_links_link_reason_check
  check (link_reason in ('address_match', 'timeline_share', 'domain_match'));

-- ---------------------------------------------------------------------------
-- Address / domain helpers
-- ---------------------------------------------------------------------------

create or replace function private.email_address_host(p_email text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(lower(split_part(trim(coalesce(p_email, '')), '@', 2)), '');
$$;

create or replace function private.is_public_email_domain(p_domain text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(trim(coalesce(p_domain, ''))) in (
    'gmail.com',
    'googlemail.com',
    'outlook.com',
    'hotmail.com',
    'live.com',
    'msn.com',
    'yahoo.com',
    'yahoo.co.uk',
    'icloud.com',
    'me.com',
    'mac.com',
    'proton.me',
    'protonmail.com',
    'aol.com',
    'gmx.com',
    'gmx.net',
    'mail.com',
    'zoho.com',
    'yandex.com',
    'yandex.ru'
  );
$$;

create or replace function private.website_host(p_website text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(
    lower(split_part(
      regexp_replace(
        regexp_replace(trim(coalesce(p_website, '')), '^https?://', '', 'i'),
        '^www\.',
        '',
        'i'
      ),
      '/',
      1
    )),
    ''
  );
$$;

create or replace function private.derive_email_domain(p_email text, p_website text)
returns extensions.citext
language plpgsql
immutable
set search_path = ''
as $$
declare
  host text;
begin
  host := private.email_address_host(p_email);
  if host is not null and host <> '' and not private.is_public_email_domain(host) then
    return host::extensions.citext;
  end if;
  host := private.website_host(p_website);
  if host is not null and host <> '' and position('.' in host) > 0
     and not private.is_public_email_domain(host) then
    return host::extensions.citext;
  end if;
  return null;
end;
$$;

create or replace function private.clients_fill_email_domain()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if nullif(btrim(coalesce(NEW.email_domain::text, '')), '') is null then
    NEW.email_domain := private.derive_email_domain(
      NEW.primary_email::text,
      NEW.website_url
    );
  else
    NEW.email_domain := lower(btrim(NEW.email_domain::text))::extensions.citext;
    if private.is_public_email_domain(NEW.email_domain::text) then
      NEW.email_domain := null;
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists clients_fill_email_domain on public.clients;
create trigger clients_fill_email_domain
before insert or update of primary_email, website_url, email_domain
on public.clients
for each row execute function private.clients_fill_email_domain();

update public.clients
set email_domain = private.derive_email_domain(primary_email::text, website_url)
where deleted_at is null
  and email_domain is null;

create or replace function private.message_participant_emails(
  p_from text,
  p_to jsonb,
  p_cc jsonb
)
returns table (addr extensions.citext)
language sql
stable
set search_path = ''
as $$
  select distinct lower(trim(x))::extensions.citext as addr
  from (
    select p_from as x
    union all
    select e ->> 'email'
    from jsonb_array_elements(coalesce(p_to, '[]'::jsonb)) e
    union all
    select e ->> 'email'
    from jsonb_array_elements(coalesce(p_cc, '[]'::jsonb)) e
  ) src
  where nullif(trim(coalesce(src.x, '')), '') is not null
    and position('@' in src.x) > 1;
$$;

-- ---------------------------------------------------------------------------
-- Link one inbound message to contacts / leads / clients
-- ---------------------------------------------------------------------------

create or replace function private.link_inbound_email_message(
  p_org_id uuid,
  p_message_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_row public.email_messages;
  match_address extensions.citext;
begin
  select * into message_row
  from public.email_messages
  where email_messages.id = p_message_id
    and email_messages.org_id = p_org_id
    and email_messages.deleted_at is null;

  if message_row.id is null then
    return;
  end if;

  for match_address in
    select addr
    from private.message_participant_emails(
      message_row.from_address::text,
      message_row.to_addresses,
      message_row.cc_addresses
    )
  loop
    insert into public.email_message_links (
      org_id, message_id, entity_type, entity_id, link_reason
    )
    select p_org_id, message_row.id, 'contact', c.id, 'address_match'
    from public.contacts c
    where c.org_id = p_org_id
      and c.deleted_at is null
      and c.primary_email = match_address
    on conflict do nothing;

    insert into public.email_message_links (
      org_id, message_id, entity_type, entity_id, link_reason
    )
    select p_org_id, message_row.id, 'lead', l.id, 'address_match'
    from public.leads l
    left join public.contacts c
      on c.org_id = l.org_id
     and c.id = l.contact_id
     and c.deleted_at is null
    where l.org_id = p_org_id
      and l.deleted_at is null
      and (
        l.primary_email = match_address
        or (l.contact_id is not null and c.primary_email = match_address)
      )
    on conflict do nothing;

    insert into public.email_message_links (
      org_id, message_id, entity_type, entity_id, link_reason
    )
    select p_org_id, message_row.id, 'client', cl.id, 'address_match'
    from public.clients cl
    where cl.org_id = p_org_id
      and cl.deleted_at is null
      and cl.primary_email = match_address
    on conflict do nothing;

    insert into public.email_message_links (
      org_id, message_id, entity_type, entity_id, link_reason
    )
    select p_org_id, message_row.id, 'client', cc.client_id, 'address_match'
    from public.client_contacts cc
    join public.contacts c
      on c.id = cc.contact_id
     and c.org_id = cc.org_id
     and c.deleted_at is null
    where cc.org_id = p_org_id
      and cc.deleted_at is null
      and c.primary_email = match_address
    on conflict do nothing;
  end loop;

  insert into public.email_message_links (
    org_id, message_id, entity_type, entity_id, link_reason
  )
  select p_org_id, message_row.id, 'client', cl.id, 'domain_match'
  from public.clients cl
  where cl.org_id = p_org_id
    and cl.deleted_at is null
    and cl.email_domain is not null
    and exists (
      select 1
      from private.message_participant_emails(
        message_row.from_address::text,
        message_row.to_addresses,
        message_row.cc_addresses
      ) e
      where private.email_address_host(e.addr::text) = cl.email_domain::text
    )
  on conflict do nothing;
end;
$$;

revoke all on function private.link_inbound_email_message(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.relink_mailbox_email_messages(
  p_org_id uuid,
  p_mailbox_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_id uuid;
  linked integer := 0;
begin
  for message_id in
    select email_messages.id
    from public.email_messages
    where email_messages.org_id = p_org_id
      and email_messages.mailbox_account_id = p_mailbox_id
      and email_messages.deleted_at is null
  loop
    perform private.link_inbound_email_message(p_org_id, message_id);
    linked := linked + 1;
  end loop;
  return linked;
end;
$$;

revoke all on function public.relink_mailbox_email_messages(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.relink_mailbox_email_messages(uuid, uuid) to service_role;

create or replace function public.relink_entity_email_messages(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_id uuid;
begin
  if p_entity_type not in ('contact', 'lead', 'client') then
    return;
  end if;

  delete from public.email_message_links
  where email_message_links.org_id = p_org_id
    and email_message_links.entity_type = p_entity_type
    and email_message_links.entity_id = p_entity_id
    and email_message_links.link_reason in ('address_match', 'domain_match');

  for message_id in
    select email_messages.id
    from public.email_messages
    where email_messages.org_id = p_org_id
      and email_messages.deleted_at is null
      and email_messages.direction = 'inbound'
  loop
    perform private.link_inbound_email_message(p_org_id, message_id);
  end loop;
end;
$$;

revoke all on function public.relink_entity_email_messages(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.relink_entity_email_messages(uuid, text, uuid) to service_role;

create or replace function private.relink_contact_email_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'UPDATE'
     and NEW.primary_email is not distinct from OLD.primary_email then
    return NEW;
  end if;
  perform public.relink_entity_email_messages(NEW.org_id, 'contact', NEW.id);
  return NEW;
end;
$$;

drop trigger if exists contacts_relink_email on public.contacts;
create trigger contacts_relink_email
after insert or update of primary_email
on public.contacts
for each row execute function private.relink_contact_email_after_change();

create or replace function private.relink_client_email_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'UPDATE'
     and NEW.primary_email is not distinct from OLD.primary_email
     and NEW.email_domain is not distinct from OLD.email_domain then
    return NEW;
  end if;
  perform public.relink_entity_email_messages(NEW.org_id, 'client', NEW.id);
  return NEW;
end;
$$;

drop trigger if exists clients_relink_email on public.clients;
create trigger clients_relink_email
after insert or update of primary_email, email_domain
on public.clients
for each row execute function private.relink_client_email_after_change();

-- ---------------------------------------------------------------------------
-- Sync lease / cursor RPCs
-- ---------------------------------------------------------------------------

create or replace function public.claim_mailbox_sync_lease(
  p_mailbox_id uuid,
  p_holder text,
  p_lease_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  mailbox public.mailbox_accounts;
  now_ts timestamptz := now();
begin
  select * into mailbox
  from public.mailbox_accounts
  where mailbox_accounts.id = p_mailbox_id
    and mailbox_accounts.deleted_at is null
  for update;

  if mailbox.id is null then
    return jsonb_build_object('claimed', false, 'reason', 'not_found');
  end if;

  if mailbox.status = 'error' and mailbox.consecutive_auth_failures >= 3 then
    return jsonb_build_object('claimed', false, 'reason', 'circuit_open');
  end if;

  if mailbox.sync_lease_until is not null
     and mailbox.sync_lease_until > now_ts
     and mailbox.sync_lease_holder is distinct from p_holder then
    return jsonb_build_object('claimed', false, 'reason', 'lease_held');
  end if;

  update public.mailbox_accounts
  set
    sync_lease_until = now_ts + make_interval(secs => greatest(p_lease_seconds, 30)),
    sync_lease_holder = p_holder,
    updated_at = now_ts
  where mailbox_accounts.id = mailbox.id;

  return jsonb_build_object(
    'claimed', true,
    'mailbox_id', mailbox.id,
    'org_id', mailbox.org_id,
    'membership_id', mailbox.membership_id,
    'email_address', mailbox.email_address,
    'imap_host', mailbox.imap_host,
    'imap_port', mailbox.imap_port,
    'imap_security', mailbox.imap_security,
    'username', mailbox.username,
    'sync_lookback_days', mailbox.sync_lookback_days,
    'sync_max_messages', mailbox.sync_max_messages,
    'sync_max_body_bytes', mailbox.sync_max_body_bytes,
    'sync_attachments_metadata_only', mailbox.sync_attachments_metadata_only,
    'credentials_configured', (mailbox.secret_ref is not null),
    'imap_uidvalidity', mailbox.imap_uidvalidity,
    'sync_high_uid', mailbox.sync_high_uid,
    'sync_low_uid', mailbox.sync_low_uid,
    'sync_catchup_complete', mailbox.sync_catchup_complete
  );
end;
$$;

create or replace function public.advance_mailbox_sync_cursor(
  p_mailbox_id uuid,
  p_uidvalidity bigint,
  p_uid bigint,
  p_mode text,
  p_catchup_complete boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  mailbox public.mailbox_accounts;
begin
  if p_mode not in ('first', 'newer', 'older') then
    raise exception 'Invalid sync cursor mode' using errcode = '22023';
  end if;

  select * into mailbox
  from public.mailbox_accounts
  where mailbox_accounts.id = p_mailbox_id
    and mailbox_accounts.deleted_at is null
  for update;

  if mailbox.id is null then
    return;
  end if;

  if mailbox.imap_uidvalidity is distinct from p_uidvalidity then
    mailbox.sync_high_uid := null;
    mailbox.sync_low_uid := null;
    mailbox.sync_catchup_complete := false;
  end if;

  if p_mode = 'newer' then
    mailbox.sync_high_uid := greatest(coalesce(mailbox.sync_high_uid, p_uid), p_uid);
  elsif p_mode = 'older' then
    mailbox.sync_low_uid := least(coalesce(mailbox.sync_low_uid, p_uid), p_uid);
  else
    mailbox.sync_high_uid := greatest(coalesce(mailbox.sync_high_uid, p_uid), p_uid);
    mailbox.sync_low_uid := least(coalesce(mailbox.sync_low_uid, p_uid), p_uid);
  end if;

  update public.mailbox_accounts
  set
    imap_uidvalidity = p_uidvalidity,
    sync_high_uid = mailbox.sync_high_uid,
    sync_low_uid = mailbox.sync_low_uid,
    sync_catchup_complete = coalesce(p_catchup_complete, mailbox.sync_catchup_complete),
    updated_at = now()
  where mailbox_accounts.id = mailbox.id;
end;
$$;

revoke all on function public.advance_mailbox_sync_cursor(uuid, bigint, bigint, text, boolean)
  from public, anon, authenticated;
grant execute on function public.advance_mailbox_sync_cursor(uuid, bigint, bigint, text, boolean)
  to service_role;

create or replace function public.set_mailbox_sync_catchup(
  p_mailbox_id uuid,
  p_uidvalidity bigint,
  p_catchup_complete boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.mailbox_accounts
  set
    imap_uidvalidity = p_uidvalidity,
    sync_catchup_complete = p_catchup_complete,
    updated_at = now()
  where mailbox_accounts.id = p_mailbox_id
    and mailbox_accounts.deleted_at is null;
end;
$$;

revoke all on function public.set_mailbox_sync_catchup(uuid, bigint, boolean)
  from public, anon, authenticated;
grant execute on function public.set_mailbox_sync_catchup(uuid, bigint, boolean) to service_role;

create or replace function public.reset_mailbox_sync_cursor(
  p_mailbox_id uuid,
  p_uidvalidity bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.mailbox_accounts
  set
    imap_uidvalidity = p_uidvalidity,
    sync_high_uid = null,
    sync_low_uid = null,
    sync_catchup_complete = false,
    updated_at = now()
  where mailbox_accounts.id = p_mailbox_id
    and mailbox_accounts.deleted_at is null;
end;
$$;

revoke all on function public.reset_mailbox_sync_cursor(uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.reset_mailbox_sync_cursor(uuid, bigint) to service_role;

create or replace function public.list_mailboxes_due_for_sync(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rows jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'org_id', m.org_id,
    'membership_id', m.membership_id,
    'imap_host', m.imap_host,
    'status', m.status,
    'consecutive_auth_failures', m.consecutive_auth_failures,
    'sync_catchup_complete', m.sync_catchup_complete
  ) order by m.sync_catchup_complete asc, m.last_checked_at nulls first), '[]'::jsonb)
  into rows
  from (
    select *
    from public.mailbox_accounts candidate
    where candidate.deleted_at is null
      and candidate.secret_ref is not null
      and candidate.status in ('pending', 'active', 'error')
      and candidate.consecutive_auth_failures < 3
      and (candidate.sync_lease_until is null or candidate.sync_lease_until < now())
    order by candidate.sync_catchup_complete asc, candidate.last_checked_at nulls first
    limit greatest(p_limit, 1)
  ) m;

  return rows;
end;
$$;

create or replace function private.mailbox_account_public_json(
  p_row public.mailbox_accounts
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_row.id,
    'org_id', p_row.org_id,
    'membership_id', p_row.membership_id,
    'email_address', p_row.email_address,
    'from_name', p_row.from_name,
    'imap_host', p_row.imap_host,
    'imap_port', p_row.imap_port,
    'imap_security', p_row.imap_security,
    'smtp_host', p_row.smtp_host,
    'smtp_port', p_row.smtp_port,
    'smtp_security', p_row.smtp_security,
    'username', p_row.username,
    'status', p_row.status,
    'auth_mode', p_row.auth_mode,
    'oauth_provider', p_row.oauth_provider,
    'last_checked_at', p_row.last_checked_at,
    'last_error_code', p_row.last_error_code,
    'credentials_configured', (p_row.secret_ref is not null),
    'credentials_updated_at', p_row.credentials_updated_at,
    'sync_catchup_complete', p_row.sync_catchup_complete,
    'sync_high_uid', p_row.sync_high_uid,
    'sync_low_uid', p_row.sync_low_uid,
    'version', p_row.version,
    'created_at', p_row.created_at,
    'updated_at', p_row.updated_at
  );
$$;

-- ---------------------------------------------------------------------------
-- upsert_inbound_email_message: html, cc, metadata, imap_uid
-- ---------------------------------------------------------------------------

drop function if exists public.upsert_inbound_email_message(
  uuid, uuid, text, text, text, text, jsonb, text, text, text, timestamptz, boolean
);

create or replace function public.upsert_inbound_email_message(
  p_org_id uuid,
  p_mailbox_id uuid,
  p_provider_message_id text,
  p_provider_thread_id text,
  p_from_address text,
  p_from_name text,
  p_to_addresses jsonb,
  p_subject text,
  p_body_text text,
  p_preview_text text,
  p_received_at timestamptz,
  p_body_truncated boolean default false,
  p_body_html text default null,
  p_cc_addresses jsonb default '[]'::jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_imap_uid bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  mailbox public.mailbox_accounts;
  thread_row public.email_threads;
  message_row public.email_messages;
  is_new boolean := false;
begin
  select * into mailbox
  from public.mailbox_accounts
  where mailbox_accounts.id = p_mailbox_id
    and mailbox_accounts.org_id = p_org_id
    and mailbox_accounts.deleted_at is null;

  if mailbox.id is null then
    raise exception 'Mailbox not found'
      using errcode = 'P0002';
  end if;

  if p_provider_thread_id is not null then
    select * into thread_row
    from public.email_threads
    where email_threads.mailbox_account_id = mailbox.id
      and email_threads.provider_thread_id = p_provider_thread_id
      and email_threads.deleted_at is null;

    if thread_row.id is null then
      insert into public.email_threads (
        org_id, mailbox_account_id, owner_membership_id,
        provider_thread_id, subject_normalized, last_message_at, message_count
      )
      values (
        p_org_id, mailbox.id, mailbox.membership_id,
        p_provider_thread_id, lower(coalesce(p_subject, '')),
        coalesce(p_received_at, now()), 0
      )
      returning * into thread_row;
    end if;
  end if;

  select * into message_row
  from public.email_messages
  where email_messages.mailbox_account_id = mailbox.id
    and email_messages.provider_message_id = p_provider_message_id
    and email_messages.deleted_at is null;

  if message_row.id is null then
    insert into public.email_messages (
      org_id, mailbox_account_id, owner_membership_id, thread_id,
      direction, status, provider, provider_message_id,
      from_address, from_name, to_addresses, cc_addresses, subject,
      body_text, body_html, preview_text, body_truncated, received_at,
      metadata, imap_uid
    )
    values (
      p_org_id, mailbox.id, mailbox.membership_id, thread_row.id,
      'inbound', 'received', 'imap', p_provider_message_id,
      lower(trim(p_from_address)), nullif(trim(p_from_name), ''),
      coalesce(p_to_addresses, '[]'::jsonb),
      coalesce(p_cc_addresses, '[]'::jsonb),
      coalesce(p_subject, ''),
      p_body_text, p_body_html, p_preview_text, coalesce(p_body_truncated, false),
      coalesce(p_received_at, now()),
      coalesce(p_metadata, '{}'::jsonb),
      p_imap_uid
    )
    returning * into message_row;
    is_new := true;
  else
    update public.email_messages
    set
      subject = coalesce(p_subject, email_messages.subject),
      body_text = coalesce(p_body_text, email_messages.body_text),
      body_html = coalesce(p_body_html, email_messages.body_html),
      preview_text = coalesce(p_preview_text, email_messages.preview_text),
      body_truncated = coalesce(p_body_truncated, email_messages.body_truncated),
      cc_addresses = coalesce(p_cc_addresses, email_messages.cc_addresses),
      metadata = case
        when p_metadata is null or p_metadata = '{}'::jsonb then email_messages.metadata
        else coalesce(email_messages.metadata, '{}'::jsonb) || p_metadata
      end,
      imap_uid = coalesce(p_imap_uid, email_messages.imap_uid),
      updated_at = now()
    where email_messages.id = message_row.id
    returning * into message_row;
  end if;

  if is_new then
    perform private.create_user_notification(
      p_org_id,
      mailbox.membership_id,
      'email.received',
      'email_message',
      message_row.id,
      coalesce(nullif(btrim(p_subject), ''), '(no subject)'),
      coalesce(p_preview_text, left(coalesce(p_body_text, ''), 200))
    );
  end if;

  if thread_row.id is not null then
    update public.email_threads
    set
      last_message_at = greatest(email_threads.last_message_at, coalesce(p_received_at, now())),
      message_count = (
        select count(*)::integer from public.email_messages
        where email_messages.thread_id = thread_row.id
          and email_messages.deleted_at is null
      ),
      updated_at = now()
    where email_threads.id = thread_row.id;
  end if;

  perform private.link_inbound_email_message(p_org_id, message_row.id);

  return jsonb_build_object(
    'id', message_row.id,
    'thread_id', message_row.thread_id,
    'provider_message_id', message_row.provider_message_id,
    'owner_membership_id', message_row.owner_membership_id
  );
end;
$$;

revoke all on function public.upsert_inbound_email_message(
  uuid, uuid, text, text, text, text, jsonb, text, text, text, timestamptz, boolean,
  text, jsonb, jsonb, bigint
) from public, anon, authenticated;
grant execute on function public.upsert_inbound_email_message(
  uuid, uuid, text, text, text, text, jsonb, text, text, text, timestamptz, boolean,
  text, jsonb, jsonb, bigint
) to service_role;

-- ---------------------------------------------------------------------------
-- list_entity_email_messages: owner query-time fallback + html/attachments
-- ---------------------------------------------------------------------------

create or replace function public.list_entity_email_messages(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  membership_row public.memberships;
  rows jsonb;
  contact_email extensions.citext;
  client_email extensions.citext;
  client_domain extensions.citext;
  lead_email extensions.citext;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if p_entity_type not in ('contact', 'lead', 'client') then
    raise exception 'Invalid entity type'
      using errcode = '22023';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member', 'readonly']) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  select * into membership_row
  from public.memberships
  where memberships.org_id = p_org_id
    and memberships.user_id = actor_id
    and memberships.status = 'active';

  if p_entity_type = 'contact' then
    select contacts.primary_email into contact_email
    from public.contacts
    where contacts.id = p_entity_id
      and contacts.org_id = p_org_id
      and contacts.deleted_at is null;
  elsif p_entity_type = 'client' then
    select clients.primary_email, clients.email_domain
      into client_email, client_domain
    from public.clients
    where clients.id = p_entity_id
      and clients.org_id = p_org_id
      and clients.deleted_at is null;
  elsif p_entity_type = 'lead' then
    select coalesce(contacts.primary_email, leads.primary_email) into lead_email
    from public.leads
    left join public.contacts
      on contacts.id = leads.contact_id
     and contacts.org_id = leads.org_id
     and contacts.deleted_at is null
    where leads.id = p_entity_id
      and leads.org_id = p_org_id
      and leads.deleted_at is null;
  end if;

  select coalesce(jsonb_agg(limited.item order by limited.sort_at desc), '[]'::jsonb)
  into rows
  from (
    select deduped.item, deduped.sort_at
    from (
      select distinct on (matched.id)
        jsonb_build_object(
          'id', matched.id,
          'subject', matched.subject,
          'from_address', matched.from_address,
          'from_name', matched.from_name,
          'to_addresses', matched.to_addresses,
          'preview_text', matched.preview_text,
          'body_text', case
            when matched.owner_membership_id = membership_row.id then matched.body_text
            when matched.link_reason = 'timeline_share' then matched.body_text
            else null
          end,
          'body_html', case
            when matched.owner_membership_id = membership_row.id then matched.body_html
            when matched.link_reason = 'timeline_share' then matched.body_html
            else null
          end,
          'attachments', coalesce(matched.metadata -> 'attachments', '[]'::jsonb),
          'received_at', matched.received_at,
          'sent_at', matched.sent_at,
          'direction', matched.direction,
          'link_reason', matched.link_reason,
          'is_owner', (matched.owner_membership_id = membership_row.id)
        ) as item,
        coalesce(matched.sent_at, matched.received_at, matched.created_at) as sort_at
      from (
        select
          m.*,
          l.link_reason
        from public.email_message_links l
        join public.email_messages m
          on m.id = l.message_id and m.org_id = l.org_id
        where l.org_id = p_org_id
          and l.entity_type = p_entity_type
          and l.entity_id = p_entity_id
          and m.deleted_at is null
          and (
            m.owner_membership_id = membership_row.id
            or l.link_reason = 'timeline_share'
          )

        union all

        select
          m.*,
          'address_match'::text as link_reason
        from public.email_messages m
        where membership_row.id is not null
          and m.org_id = p_org_id
          and m.owner_membership_id = membership_row.id
          and m.deleted_at is null
          and p_entity_type = 'contact'
          and contact_email is not null
          and exists (
            select 1
            from private.message_participant_emails(
              m.from_address::text, m.to_addresses, m.cc_addresses
            ) e
            where e.addr = contact_email
          )

        union all

        select
          m.*,
          'address_match'::text as link_reason
        from public.email_messages m
        where membership_row.id is not null
          and m.org_id = p_org_id
          and m.owner_membership_id = membership_row.id
          and m.deleted_at is null
          and p_entity_type = 'lead'
          and lead_email is not null
          and exists (
            select 1
            from private.message_participant_emails(
              m.from_address::text, m.to_addresses, m.cc_addresses
            ) e
            where e.addr = lead_email
          )

        union all

        select
          m.*,
          case
            when client_email is not null and exists (
              select 1
              from private.message_participant_emails(
                m.from_address::text, m.to_addresses, m.cc_addresses
              ) e
              where e.addr = client_email
            ) then 'address_match'
            else 'domain_match'
          end as link_reason
        from public.email_messages m
        where membership_row.id is not null
          and m.org_id = p_org_id
          and m.owner_membership_id = membership_row.id
          and m.deleted_at is null
          and p_entity_type = 'client'
          and (
            (
              client_email is not null
              and exists (
                select 1
                from private.message_participant_emails(
                  m.from_address::text, m.to_addresses, m.cc_addresses
                ) e
                where e.addr = client_email
              )
            )
            or (
              client_domain is not null
              and exists (
                select 1
                from private.message_participant_emails(
                  m.from_address::text, m.to_addresses, m.cc_addresses
                ) e
                where private.email_address_host(e.addr::text) = client_domain::text
              )
            )
            or exists (
              select 1
              from public.client_contacts cc
              join public.contacts c
                on c.id = cc.contact_id
               and c.org_id = cc.org_id
               and c.deleted_at is null
              join private.message_participant_emails(
                m.from_address::text, m.to_addresses, m.cc_addresses
              ) e on e.addr = c.primary_email
              where cc.client_id = p_entity_id
                and cc.org_id = p_org_id
                and cc.deleted_at is null
            )
          )
      ) matched
      order by
        matched.id,
        case when matched.link_reason = 'timeline_share' then 0 else 1 end,
        coalesce(matched.sent_at, matched.received_at, matched.created_at) desc
    ) deduped
    order by deduped.sort_at desc
    limit greatest(least(p_limit, 200), 1)
  ) limited;

  return rows;
end;
$$;

revoke all on function public.list_entity_email_messages(uuid, text, uuid, integer)
  from public, anon;
grant execute on function public.list_entity_email_messages(uuid, text, uuid, integer)
  to authenticated;

create or replace function public.list_my_email_messages(
  p_org_id uuid,
  p_limit integer default 50,
  p_cursor_received_at timestamptz default null,
  p_cursor_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  membership_row public.memberships;
  lim integer := greatest(least(coalesce(p_limit, 50), 200), 1);
  rows jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  if not private.has_org_role(
    p_org_id,
    array['owner', 'admin', 'member', 'readonly']
  ) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select * into membership_row
  from public.memberships
  where memberships.org_id = p_org_id
    and memberships.user_id = actor_id
    and memberships.status = 'active';

  if not found then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(item order by sort_at desc, id desc), '[]'::jsonb)
  into rows
  from (
    select
      jsonb_build_object(
        'id', m.id,
        'org_id', m.org_id,
        'mailbox_account_id', m.mailbox_account_id,
        'subject', m.subject,
        'from_address', m.from_address,
        'from_name', m.from_name,
        'preview_text', m.preview_text,
        'body_text', m.body_text,
        'body_html', m.body_html,
        'attachments', coalesce(m.metadata -> 'attachments', '[]'::jsonb),
        'received_at', m.received_at,
        'sent_at', m.sent_at,
        'created_at', m.created_at,
        'direction', m.direction,
        'status', m.status,
        'is_owner', true
      ) as item,
      coalesce(m.received_at, m.created_at) as sort_at,
      m.id
    from public.email_messages m
    where m.org_id = p_org_id
      and m.owner_membership_id = membership_row.id
      and m.deleted_at is null
      and (
        p_cursor_received_at is null
        or p_cursor_id is null
        or coalesce(m.received_at, m.created_at) < p_cursor_received_at
        or (
          coalesce(m.received_at, m.created_at) = p_cursor_received_at
          and m.id < p_cursor_id
        )
      )
    order by coalesce(m.received_at, m.created_at) desc, m.id desc
    limit lim
  ) listed;

  return rows;
end;
$$;

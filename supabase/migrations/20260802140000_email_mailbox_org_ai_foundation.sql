-- Wave A: personal mailbox + email core + org AI integrations + private secret store.
-- See supabase/EMAIL_MAILBOX_VAULT_RLS_DESIGN.md (deliverable #0).

create extension if not exists pgcrypto with schema extensions;
set search_path = public, extensions, pg_catalog;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function private.current_membership_id(target_org_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select memberships.id
  from public.memberships
  join public.organisations
    on organisations.id = memberships.org_id
  where memberships.org_id = target_org_id
    and memberships.user_id = auth.uid()
    and memberships.status = 'active'
    and organisations.deleted_at is null
  limit 1;
$$;

revoke all on function private.current_membership_id(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Private secret store (Vault fallback)
-- ---------------------------------------------------------------------------

create table private.encryption_keys (
  id text primary key,
  key bytea not null,
  created_at timestamptz not null default now()
);

revoke all on table private.encryption_keys from public, anon, authenticated;

insert into private.encryption_keys (id, key)
values ('v1', extensions.gen_random_bytes(32))
on conflict (id) do nothing;

create table private.integration_secrets (
  id uuid primary key default gen_random_uuid(),
  ciphertext bytea not null,
  key_id text not null references private.encryption_keys (id),
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

revoke all on table private.integration_secrets from public, anon, authenticated;

create or replace function private.store_secret(p_plaintext text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret_id uuid := gen_random_uuid();
  enc_key bytea;
begin
  if p_plaintext is null or length(p_plaintext) = 0 then
    raise exception 'Secret plaintext is required'
      using errcode = '22023';
  end if;
  if length(p_plaintext) > 8192 then
    raise exception 'Secret plaintext is too large'
      using errcode = '22023';
  end if;

  select encryption_keys.key into enc_key
  from private.encryption_keys
  where encryption_keys.id = 'v1';

  if enc_key is null then
    raise exception 'Encryption key v1 is missing'
      using errcode = 'P0001';
  end if;

  insert into private.integration_secrets (id, ciphertext, key_id)
  values (
    secret_id,
    extensions.pgp_sym_encrypt(p_plaintext, encode(enc_key, 'hex')),
    'v1'
  );

  return secret_id;
end;
$$;

create or replace function private.read_secret(p_secret_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  enc_key bytea;
  blob bytea;
  key_name text;
begin
  if p_secret_id is null then
    return null;
  end if;

  select integration_secrets.ciphertext, integration_secrets.key_id
  into blob, key_name
  from private.integration_secrets
  where integration_secrets.id = p_secret_id;

  if blob is null then
    return null;
  end if;

  select encryption_keys.key into enc_key
  from private.encryption_keys
  where encryption_keys.id = key_name;

  if enc_key is null then
    raise exception 'Encryption key is missing'
      using errcode = 'P0001';
  end if;

  return extensions.pgp_sym_decrypt(blob, encode(enc_key, 'hex'));
end;
$$;

create or replace function private.delete_secret(p_secret_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_secret_id is null then
    return;
  end if;
  delete from private.integration_secrets
  where integration_secrets.id = p_secret_id;
end;
$$;

revoke all on function private.store_secret(text) from public, anon, authenticated;
revoke all on function private.read_secret(uuid) from public, anon, authenticated;
revoke all on function private.delete_secret(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- mailbox_accounts
-- ---------------------------------------------------------------------------

create table public.mailbox_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  membership_id uuid not null,
  email_address citext not null,
  from_name text,
  imap_host text not null,
  imap_port integer not null check (imap_port between 1 and 65535),
  imap_security text not null default 'tls'
    check (imap_security in ('tls', 'starttls', 'none')),
  smtp_host text not null,
  smtp_port integer not null check (smtp_port between 1 and 65535),
  smtp_security text not null default 'tls'
    check (smtp_security in ('tls', 'starttls', 'none')),
  username text not null,
  secret_ref uuid,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'error', 'disabled')),
  last_checked_at timestamptz,
  last_error_code text,
  credentials_updated_at timestamptz,
  -- Wave B sync bounds (schema-ready)
  sync_lookback_days integer not null default 14 check (sync_lookback_days between 1 and 90),
  sync_max_messages integer not null default 100 check (sync_max_messages between 1 and 1000),
  sync_max_body_bytes integer not null default 262144 check (sync_max_body_bytes between 1024 and 1048576),
  sync_attachments_metadata_only boolean not null default true,
  sync_lease_until timestamptz,
  sync_lease_holder text,
  consecutive_auth_failures integer not null default 0 check (consecutive_auth_failures >= 0),
  constraint mailbox_accounts_org_id_id_key unique (org_id, id),
  constraint mailbox_accounts_membership_fk
    foreign key (org_id, membership_id)
    references public.memberships (org_id, id)
    on delete cascade,
  constraint mailbox_accounts_email_check
    check (char_length(email_address::text) between 3 and 320)
);

create unique index mailbox_accounts_org_membership_uidx
  on public.mailbox_accounts (org_id, membership_id)
  where deleted_at is null;

create index mailbox_accounts_org_status_idx
  on public.mailbox_accounts (org_id, status)
  where deleted_at is null;

create trigger mailbox_accounts_stamp_business_row
before insert or update on public.mailbox_accounts
for each row execute function private.stamp_business_row();

alter table public.mailbox_accounts enable row level security;
revoke all on table public.mailbox_accounts from public, anon, authenticated;
grant select (
  id, org_id, created_at, updated_at, created_by, updated_by, deleted_at, version,
  membership_id, email_address, from_name,
  imap_host, imap_port, imap_security,
  smtp_host, smtp_port, smtp_security,
  username, status, last_checked_at, last_error_code, credentials_updated_at,
  sync_lookback_days, sync_max_messages, sync_max_body_bytes,
  sync_attachments_metadata_only, sync_lease_until, sync_lease_holder,
  consecutive_auth_failures
) on table public.mailbox_accounts to authenticated;

create policy mailbox_accounts_select_owner on public.mailbox_accounts
for select to authenticated
using (
  deleted_at is null
  and membership_id = private.current_membership_id(org_id)
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
);

-- Mutations go through security definer RPCs only (no authenticated INSERT/UPDATE/DELETE grants).

-- ---------------------------------------------------------------------------
-- email_threads / email_messages / reads / links
-- ---------------------------------------------------------------------------

create table public.email_threads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  mailbox_account_id uuid not null,
  owner_membership_id uuid not null,
  provider_thread_id text,
  subject_normalized text not null default '',
  last_message_at timestamptz not null default now(),
  message_count integer not null default 0 check (message_count >= 0),
  constraint email_threads_org_id_id_key unique (org_id, id),
  constraint email_threads_mailbox_fk
    foreign key (org_id, mailbox_account_id)
    references public.mailbox_accounts (org_id, id)
    on delete cascade,
  constraint email_threads_owner_membership_fk
    foreign key (org_id, owner_membership_id)
    references public.memberships (org_id, id)
    on delete cascade
);

create unique index email_threads_mailbox_provider_uidx
  on public.email_threads (mailbox_account_id, provider_thread_id)
  where deleted_at is null and provider_thread_id is not null;

create index email_threads_owner_idx
  on public.email_threads (org_id, owner_membership_id)
  where deleted_at is null;

create trigger email_threads_stamp_business_row
before insert or update on public.email_threads
for each row execute function private.stamp_business_row();

create table public.email_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  mailbox_account_id uuid not null,
  owner_membership_id uuid not null,
  thread_id uuid,
  direction text not null check (direction in ('inbound', 'outbound')),
  status text not null default 'received'
    check (status in ('draft', 'queued', 'sent', 'delivered', 'failed', 'received')),
  provider text,
  provider_message_id text,
  in_reply_to_message_id uuid,
  from_address citext not null,
  from_name text,
  to_addresses jsonb not null default '[]'::jsonb,
  cc_addresses jsonb not null default '[]'::jsonb,
  bcc_addresses jsonb not null default '[]'::jsonb,
  reply_to_addresses jsonb not null default '[]'::jsonb,
  subject text not null default '',
  body_text text,
  body_html text,
  preview_text text,
  body_truncated boolean not null default false,
  template_id uuid,
  sent_at timestamptz,
  received_at timestamptz,
  recipient_opened_at timestamptz,
  failed_at timestamptz,
  failure_code text,
  metadata jsonb not null default '{}'::jsonb,
  constraint email_messages_org_id_id_key unique (org_id, id),
  constraint email_messages_mailbox_fk
    foreign key (org_id, mailbox_account_id)
    references public.mailbox_accounts (org_id, id)
    on delete cascade,
  constraint email_messages_owner_membership_fk
    foreign key (org_id, owner_membership_id)
    references public.memberships (org_id, id)
    on delete cascade,
  constraint email_messages_thread_fk
    foreign key (org_id, thread_id)
    references public.email_threads (org_id, id)
    on delete set null (thread_id),
  constraint email_messages_in_reply_fk
    foreign key (org_id, in_reply_to_message_id)
    references public.email_messages (org_id, id)
    on delete set null (in_reply_to_message_id)
);

create unique index email_messages_mailbox_provider_uidx
  on public.email_messages (mailbox_account_id, provider_message_id)
  where deleted_at is null and provider_message_id is not null;

create index email_messages_owner_idx
  on public.email_messages (org_id, owner_membership_id)
  where deleted_at is null;

create index email_messages_thread_idx
  on public.email_messages (org_id, thread_id)
  where deleted_at is null;

create trigger email_messages_stamp_business_row
before insert or update on public.email_messages
for each row execute function private.stamp_business_row();

create table public.email_message_reads (
  org_id uuid not null references public.organisations (id) on delete cascade,
  message_id uuid not null,
  membership_id uuid not null,
  read_at timestamptz not null default now(),
  archived_at timestamptz,
  primary key (message_id, membership_id),
  constraint email_message_reads_message_fk
    foreign key (org_id, message_id)
    references public.email_messages (org_id, id)
    on delete cascade,
  constraint email_message_reads_membership_fk
    foreign key (org_id, membership_id)
    references public.memberships (org_id, id)
    on delete cascade
);

create table public.email_message_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  message_id uuid not null,
  entity_type text not null check (entity_type in ('contact', 'lead', 'client')),
  entity_id uuid not null,
  link_reason text not null check (link_reason in ('address_match', 'timeline_share')),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  constraint email_message_links_message_fk
    foreign key (org_id, message_id)
    references public.email_messages (org_id, id)
    on delete cascade,
  constraint email_message_links_unique
    unique (message_id, entity_type, entity_id, link_reason)
);

create index email_message_links_entity_idx
  on public.email_message_links (org_id, entity_type, entity_id);

-- RLS: threads / messages — owner OR timeline_share grant
alter table public.email_threads enable row level security;
alter table public.email_messages enable row level security;
alter table public.email_message_reads enable row level security;
alter table public.email_message_links enable row level security;

revoke all on table public.email_threads from public, anon, authenticated;
revoke all on table public.email_messages from public, anon, authenticated;
revoke all on table public.email_message_reads from public, anon, authenticated;
revoke all on table public.email_message_links from public, anon, authenticated;

grant select on table public.email_threads to authenticated;
grant select on table public.email_messages to authenticated;
grant select, insert, update on table public.email_message_reads to authenticated;
grant select on table public.email_message_links to authenticated;

create policy email_threads_select_owner_or_share on public.email_threads
for select to authenticated
using (
  deleted_at is null
  and private.has_org_role(org_id, array['owner', 'admin', 'member', 'readonly'])
  and (
    owner_membership_id = private.current_membership_id(org_id)
    or exists (
      select 1
      from public.email_messages m
      join public.email_message_links l
        on l.message_id = m.id
       and l.org_id = m.org_id
      where m.thread_id = email_threads.id
        and m.org_id = email_threads.org_id
        and m.deleted_at is null
        and l.link_reason = 'timeline_share'
    )
  )
);

create policy email_messages_select_owner_or_share on public.email_messages
for select to authenticated
using (
  deleted_at is null
  and private.has_org_role(org_id, array['owner', 'admin', 'member', 'readonly'])
  and (
    owner_membership_id = private.current_membership_id(org_id)
    or exists (
      select 1
      from public.email_message_links l
      where l.message_id = email_messages.id
        and l.org_id = email_messages.org_id
        and l.link_reason = 'timeline_share'
    )
  )
);

create policy email_message_reads_select_own on public.email_message_reads
for select to authenticated
using (
  membership_id = private.current_membership_id(org_id)
  and private.has_org_role(org_id, array['owner', 'admin', 'member', 'readonly'])
);

create policy email_message_reads_insert_own on public.email_message_reads
for insert to authenticated
with check (
  membership_id = private.current_membership_id(org_id)
  and private.has_org_role(org_id, array['owner', 'admin', 'member'])
);

create policy email_message_reads_update_own on public.email_message_reads
for update to authenticated
using (
  membership_id = private.current_membership_id(org_id)
  and private.has_org_role(org_id, array['owner', 'admin', 'member'])
)
with check (
  membership_id = private.current_membership_id(org_id)
);

create policy email_message_links_select_owner_or_share on public.email_message_links
for select to authenticated
using (
  private.has_org_role(org_id, array['owner', 'admin', 'member', 'readonly'])
  and (
    exists (
      select 1
      from public.email_messages m
      where m.id = email_message_links.message_id
        and m.org_id = email_message_links.org_id
        and m.deleted_at is null
        and m.owner_membership_id = private.current_membership_id(org_id)
    )
    or link_reason = 'timeline_share'
  )
);

-- ---------------------------------------------------------------------------
-- integrations (org AI providers)
-- ---------------------------------------------------------------------------

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  type text not null,
  name text not null,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'error', 'disabled')),
  config jsonb not null default '{}'::jsonb,
  secret_ref uuid,
  external_account_id text,
  connected_by uuid references public.profiles (id) on delete set null,
  last_sync_at timestamptz,
  last_error_code text,
  credentials_updated_at timestamptz,
  constraint integrations_org_id_id_key unique (org_id, id),
  constraint integrations_type_check
    check (type in ('ai_openai', 'ai_anthropic', 'ai_google', 'ai_openrouter'))
);

create unique index integrations_org_type_active_uidx
  on public.integrations (org_id, type)
  where deleted_at is null;

create trigger integrations_stamp_business_row
before insert or update on public.integrations
for each row execute function private.stamp_business_row();

alter table public.integrations enable row level security;
revoke all on table public.integrations from public, anon, authenticated;
grant select (
  id, org_id, created_at, updated_at, created_by, updated_by, deleted_at, version,
  type, name, status, config, external_account_id, connected_by,
  last_sync_at, last_error_code, credentials_updated_at
) on table public.integrations to authenticated;

create policy integrations_select_member on public.integrations
for select to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
);

-- ---------------------------------------------------------------------------
-- RPCs: mailbox upsert / disconnect / test helpers
-- ---------------------------------------------------------------------------

create or replace function public.upsert_mailbox_account(
  p_org_id uuid,
  p_email_address text,
  p_from_name text,
  p_imap_host text,
  p_imap_port integer,
  p_imap_security text,
  p_smtp_host text,
  p_smtp_port integer,
  p_smtp_security text,
  p_username text,
  p_password text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  membership_row public.memberships;
  existing public.mailbox_accounts;
  new_secret uuid;
  old_secret uuid;
  result_row public.mailbox_accounts;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(
    p_org_id,
    array['owner', 'admin', 'member']
  ) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  select * into membership_row
  from public.memberships
  where memberships.org_id = p_org_id
    and memberships.user_id = actor_id
    and memberships.status = 'active';

  if membership_row.id is null then
    raise exception 'No active membership'
      using errcode = '42501';
  end if;

  if membership_row.role = 'billing' or membership_row.role = 'readonly' then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  select * into existing
  from public.mailbox_accounts
  where mailbox_accounts.org_id = p_org_id
    and mailbox_accounts.membership_id = membership_row.id
    and mailbox_accounts.deleted_at is null
  for update;

  if existing.id is null and (p_password is null or length(p_password) = 0) then
    raise exception 'Password is required when creating a mailbox'
      using errcode = '22023';
  end if;

  if p_password is not null and length(p_password) > 0 then
    new_secret := private.store_secret(p_password);
  else
    new_secret := existing.secret_ref;
  end if;

  if existing.id is null then
    insert into public.mailbox_accounts (
      org_id,
      membership_id,
      email_address,
      from_name,
      imap_host,
      imap_port,
      imap_security,
      smtp_host,
      smtp_port,
      smtp_security,
      username,
      secret_ref,
      status,
      credentials_updated_at,
      created_by,
      updated_by
    )
    values (
      p_org_id,
      membership_row.id,
      lower(trim(p_email_address)),
      nullif(trim(p_from_name), ''),
      trim(p_imap_host),
      p_imap_port,
      p_imap_security,
      trim(p_smtp_host),
      p_smtp_port,
      p_smtp_security,
      trim(p_username),
      new_secret,
      'active',
      case when p_password is not null and length(p_password) > 0 then now() else null end,
      actor_id,
      actor_id
    )
    returning * into result_row;
  else
    old_secret := existing.secret_ref;
    update public.mailbox_accounts
    set
      email_address = lower(trim(p_email_address)),
      from_name = nullif(trim(p_from_name), ''),
      imap_host = trim(p_imap_host),
      imap_port = p_imap_port,
      imap_security = p_imap_security,
      smtp_host = trim(p_smtp_host),
      smtp_port = p_smtp_port,
      smtp_security = p_smtp_security,
      username = trim(p_username),
      secret_ref = new_secret,
      status = 'active',
      last_error_code = null,
      consecutive_auth_failures = 0,
      credentials_updated_at = case
        when p_password is not null and length(p_password) > 0 then now()
        else existing.credentials_updated_at
      end,
      updated_by = actor_id,
      version = existing.version + 1
    where mailbox_accounts.id = existing.id
    returning * into result_row;

    if p_password is not null and length(p_password) > 0
       and old_secret is not null
       and old_secret is distinct from new_secret then
      perform private.delete_secret(old_secret);
    end if;
  end if;

  return jsonb_build_object(
    'id', result_row.id,
    'org_id', result_row.org_id,
    'membership_id', result_row.membership_id,
    'email_address', result_row.email_address,
    'from_name', result_row.from_name,
    'imap_host', result_row.imap_host,
    'imap_port', result_row.imap_port,
    'imap_security', result_row.imap_security,
    'smtp_host', result_row.smtp_host,
    'smtp_port', result_row.smtp_port,
    'smtp_security', result_row.smtp_security,
    'username', result_row.username,
    'status', result_row.status,
    'last_checked_at', result_row.last_checked_at,
    'last_error_code', result_row.last_error_code,
    'credentials_configured', (result_row.secret_ref is not null),
    'credentials_updated_at', result_row.credentials_updated_at,
    'version', result_row.version,
    'created_at', result_row.created_at,
    'updated_at', result_row.updated_at
  );
end;
$$;

create or replace function public.disconnect_mailbox_account(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  membership_row public.memberships;
  existing public.mailbox_accounts;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(
    p_org_id,
    array['owner', 'admin', 'member']
  ) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  select * into membership_row
  from public.memberships
  where memberships.org_id = p_org_id
    and memberships.user_id = actor_id
    and memberships.status = 'active';

  if membership_row.id is null or membership_row.role in ('billing', 'readonly') then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  select * into existing
  from public.mailbox_accounts
  where mailbox_accounts.org_id = p_org_id
    and mailbox_accounts.membership_id = membership_row.id
    and mailbox_accounts.deleted_at is null
  for update;

  if existing.id is null then
    raise exception 'Mailbox not found'
      using errcode = 'P0002';
  end if;

  update public.mailbox_accounts
  set
    deleted_at = now(),
    secret_ref = null,
    status = 'disabled',
    updated_by = actor_id,
    version = existing.version + 1
  where mailbox_accounts.id = existing.id;

  if existing.secret_ref is not null then
    perform private.delete_secret(existing.secret_ref);
  end if;
end;
$$;

create or replace function public.get_mailbox_account(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  membership_row public.memberships;
  existing public.mailbox_accounts;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(
    p_org_id,
    array['owner', 'admin', 'member', 'readonly']
  ) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  select * into membership_row
  from public.memberships
  where memberships.org_id = p_org_id
    and memberships.user_id = actor_id
    and memberships.status = 'active';

  if membership_row.id is null then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  select * into existing
  from public.mailbox_accounts
  where mailbox_accounts.org_id = p_org_id
    and mailbox_accounts.membership_id = membership_row.id
    and mailbox_accounts.deleted_at is null;

  if existing.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', existing.id,
    'org_id', existing.org_id,
    'membership_id', existing.membership_id,
    'email_address', existing.email_address,
    'from_name', existing.from_name,
    'imap_host', existing.imap_host,
    'imap_port', existing.imap_port,
    'imap_security', existing.imap_security,
    'smtp_host', existing.smtp_host,
    'smtp_port', existing.smtp_port,
    'smtp_security', existing.smtp_security,
    'username', existing.username,
    'status', existing.status,
    'last_checked_at', existing.last_checked_at,
    'last_error_code', existing.last_error_code,
    'credentials_configured', (existing.secret_ref is not null),
    'credentials_updated_at', existing.credentials_updated_at,
    'version', existing.version,
    'created_at', existing.created_at,
    'updated_at', existing.updated_at
  );
end;
$$;

create or replace function public.mailbox_credentials_present(
  p_org_id uuid,
  p_password text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  membership_row public.memberships;
  existing public.mailbox_accounts;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if p_password is not null and length(p_password) > 0 then
    return true;
  end if;

  select * into membership_row
  from public.memberships
  where memberships.org_id = p_org_id
    and memberships.user_id = actor_id
    and memberships.status = 'active';

  if membership_row.id is null then
    return false;
  end if;

  select * into existing
  from public.mailbox_accounts
  where mailbox_accounts.org_id = p_org_id
    and mailbox_accounts.membership_id = membership_row.id
    and mailbox_accounts.deleted_at is null;

  return existing.secret_ref is not null;
end;
$$;

revoke all on function public.upsert_mailbox_account(
  uuid, text, text, text, integer, text, text, integer, text, text, text
) from public, anon;
grant execute on function public.upsert_mailbox_account(
  uuid, text, text, text, integer, text, text, integer, text, text, text
) to authenticated;

revoke all on function public.disconnect_mailbox_account(uuid) from public, anon;
grant execute on function public.disconnect_mailbox_account(uuid) to authenticated;

revoke all on function public.get_mailbox_account(uuid) from public, anon;
grant execute on function public.get_mailbox_account(uuid) to authenticated;

revoke all on function public.mailbox_credentials_present(uuid, text) from public, anon;
grant execute on function public.mailbox_credentials_present(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPCs: AI integrations connect / disconnect / list
-- ---------------------------------------------------------------------------

create or replace function public.upsert_ai_integration(
  p_org_id uuid,
  p_provider text,
  p_api_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  integration_type text;
  display_name text;
  existing public.integrations;
  new_secret uuid;
  old_secret uuid;
  result_row public.integrations;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin']) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  if p_api_key is null or length(trim(p_api_key)) < 8 then
    raise exception 'API key is required'
      using errcode = '22023';
  end if;

  case p_provider
    when 'openai' then
      integration_type := 'ai_openai';
      display_name := 'OpenAI';
    when 'anthropic' then
      integration_type := 'ai_anthropic';
      display_name := 'Anthropic';
    when 'google' then
      integration_type := 'ai_google';
      display_name := 'Google';
    when 'openrouter' then
      integration_type := 'ai_openrouter';
      display_name := 'OpenRouter';
    else
      raise exception 'Unknown AI provider'
        using errcode = '22023';
  end case;

  select * into existing
  from public.integrations
  where integrations.org_id = p_org_id
    and integrations.type = integration_type
    and integrations.deleted_at is null
  for update;

  new_secret := private.store_secret(trim(p_api_key));

  if existing.id is null then
    insert into public.integrations (
      org_id,
      type,
      name,
      status,
      config,
      secret_ref,
      connected_by,
      credentials_updated_at,
      created_by,
      updated_by
    )
    values (
      p_org_id,
      integration_type,
      display_name,
      'active',
      jsonb_build_object('provider', p_provider, 'auth_mode', 'api_key'),
      new_secret,
      actor_id,
      now(),
      actor_id,
      actor_id
    )
    returning * into result_row;
  else
    old_secret := existing.secret_ref;
    update public.integrations
    set
      name = display_name,
      status = 'active',
      config = jsonb_build_object('provider', p_provider, 'auth_mode', 'api_key'),
      secret_ref = new_secret,
      connected_by = actor_id,
      credentials_updated_at = now(),
      last_error_code = null,
      updated_by = actor_id,
      version = existing.version + 1
    where integrations.id = existing.id
    returning * into result_row;

    if old_secret is not null and old_secret is distinct from new_secret then
      perform private.delete_secret(old_secret);
    end if;
  end if;

  return jsonb_build_object(
    'id', result_row.id,
    'org_id', result_row.org_id,
    'type', result_row.type,
    'provider', p_provider,
    'name', result_row.name,
    'status', result_row.status,
    'config', result_row.config,
    'credentials_configured', (result_row.secret_ref is not null),
    'credentials_updated_at', result_row.credentials_updated_at,
    'connected_by', result_row.connected_by,
    'last_error_code', result_row.last_error_code,
    'version', result_row.version,
    'created_at', result_row.created_at,
    'updated_at', result_row.updated_at
  );
end;
$$;

create or replace function public.disconnect_ai_integration(
  p_org_id uuid,
  p_provider text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  integration_type text;
  existing public.integrations;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin']) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  case p_provider
    when 'openai' then integration_type := 'ai_openai';
    when 'anthropic' then integration_type := 'ai_anthropic';
    when 'google' then integration_type := 'ai_google';
    when 'openrouter' then integration_type := 'ai_openrouter';
    else
      raise exception 'Unknown AI provider'
        using errcode = '22023';
  end case;

  select * into existing
  from public.integrations
  where integrations.org_id = p_org_id
    and integrations.type = integration_type
    and integrations.deleted_at is null
  for update;

  if existing.id is null then
    raise exception 'Integration not found'
      using errcode = 'P0002';
  end if;

  update public.integrations
  set
    deleted_at = now(),
    secret_ref = null,
    status = 'disabled',
    updated_by = actor_id,
    version = existing.version + 1
  where integrations.id = existing.id;

  if existing.secret_ref is not null then
    perform private.delete_secret(existing.secret_ref);
  end if;
end;
$$;

create or replace function public.list_ai_integrations(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  rows jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(
    p_org_id,
    array['owner', 'admin', 'member', 'readonly']
  ) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', i.id,
      'org_id', i.org_id,
      'type', i.type,
      'provider', case i.type
        when 'ai_openai' then 'openai'
        when 'ai_anthropic' then 'anthropic'
        when 'ai_google' then 'google'
        when 'ai_openrouter' then 'openrouter'
        else null
      end,
      'name', i.name,
      'status', i.status,
      'config', i.config,
      'credentials_configured', (i.secret_ref is not null),
      'credentials_updated_at', i.credentials_updated_at,
      'connected_by', i.connected_by,
      'last_error_code', i.last_error_code,
      'version', i.version,
      'created_at', i.created_at,
      'updated_at', i.updated_at
    )
    order by i.type
  ), '[]'::jsonb)
  into rows
  from public.integrations i
  where i.org_id = p_org_id
    and i.deleted_at is null
    and i.type like 'ai_%';

  return rows;
end;
$$;

revoke all on function public.upsert_ai_integration(uuid, text, text) from public, anon;
grant execute on function public.upsert_ai_integration(uuid, text, text) to authenticated;

revoke all on function public.disconnect_ai_integration(uuid, text) from public, anon;
grant execute on function public.disconnect_ai_integration(uuid, text) to authenticated;

revoke all on function public.list_ai_integrations(uuid) from public, anon;
grant execute on function public.list_ai_integrations(uuid) to authenticated;

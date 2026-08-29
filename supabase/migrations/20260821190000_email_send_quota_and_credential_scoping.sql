-- Email send hardening follow-ups (security review):
-- 1. Per-mailbox daily outbound send quota, enforced inside begin_email_compose_idempotent
--    and begin_email_reply_idempotent (both paths drive real SMTP deliveries).
-- 2. Compose recipients default to the entity primary email; arbitrary recipients are
--    rejected unless the trusted Edge explicitly allows them (allow_external_recipients),
--    restricted to owner/admin callers.
-- 3. read_mailbox_sync_credentials gains an optional org-scoped caller check so user-backed
--    flows cannot resolve another member's mailbox credentials, while Edge-only sync paths
--    keep the unscoped call.

-- ---------------------------------------------------------------------------
-- Daily send quota state
-- ---------------------------------------------------------------------------

create table if not exists public.email_send_quota_usage (
  org_id uuid not null references public.organisations (id) on delete cascade,
  mailbox_account_id uuid not null references public.mailbox_accounts (id) on delete cascade,
  usage_date date not null default (now() at time zone 'utc')::date,
  sent_count integer not null default 0,
  constraint email_send_quota_usage_count_check check (sent_count >= 0),
  primary key (mailbox_account_id, usage_date)
);

comment on table public.email_send_quota_usage is
  'Per-mailbox daily outbound send counters backing the SMTP rate limit; written only by security definer RPCs.';

create index email_send_quota_usage_org_date_idx
  on public.email_send_quota_usage (org_id, usage_date);

alter table public.email_send_quota_usage enable row level security;

revoke all on table public.email_send_quota_usage from public, anon, authenticated;

create or replace function private.email_send_quota_limit()
returns integer
language sql
stable
set search_path = ''
as $$
  select 200;
$$;

-- ---------------------------------------------------------------------------
-- Credential read: optional org-scoped caller verification
-- ---------------------------------------------------------------------------

create or replace function public.read_mailbox_sync_credentials(
  p_mailbox_id uuid,
  p_org_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  mailbox public.mailbox_accounts;
  password text;
  actor_id uuid;
  membership_row public.memberships;
begin
  -- When called on behalf of a user-backed flow, p_org_id pins the caller's org and
  -- the mailbox must belong to the caller's own membership. Edge-only sync paths
  -- (service role, no JWT) omit p_org_id and get the previous behaviour.
  if p_org_id is not null then
    actor_id := auth.uid();
    if actor_id is null then
      raise exception 'Authentication is required'
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
  end if;

  select * into mailbox
  from public.mailbox_accounts
  where mailbox_accounts.id = p_mailbox_id
    and mailbox_accounts.deleted_at is null;

  if mailbox.id is null then
    raise exception 'Mailbox not found'
      using errcode = 'P0002';
  end if;

  if p_org_id is not null
     and mailbox.org_id <> p_org_id
  then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  if membership_row.id is not null
     and mailbox.membership_id <> membership_row.id
  then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  if mailbox.secret_ref is null then
    return jsonb_build_object(
      'auth_mode', coalesce(mailbox.auth_mode, 'password'),
      'oauth_provider', mailbox.oauth_provider,
      'password', null,
      'token_blob', null,
      'username', mailbox.username,
      'imap_host', mailbox.imap_host,
      'imap_port', mailbox.imap_port,
      'imap_security', mailbox.imap_security,
      'smtp_host', mailbox.smtp_host,
      'smtp_port', mailbox.smtp_port,
      'smtp_security', mailbox.smtp_security,
      'email_address', mailbox.email_address
    );
  end if;

  password := private.read_secret(mailbox.secret_ref);

  if coalesce(mailbox.auth_mode, 'password') = 'oauth' then
    return jsonb_build_object(
      'auth_mode', 'oauth',
      'oauth_provider', mailbox.oauth_provider,
      'password', null,
      'token_blob', password,
      'username', mailbox.username,
      'imap_host', mailbox.imap_host,
      'imap_port', mailbox.imap_port,
      'imap_security', mailbox.imap_security,
      'smtp_host', mailbox.smtp_host,
      'smtp_port', mailbox.smtp_port,
      'smtp_security', mailbox.smtp_security,
      'email_address', mailbox.email_address
    );
  end if;

  return jsonb_build_object(
    'auth_mode', 'password',
    'oauth_provider', null,
    'password', password,
    'token_blob', null,
    'username', mailbox.username,
    'imap_host', mailbox.imap_host,
    'imap_port', mailbox.imap_port,
    'imap_security', mailbox.imap_security,
    'smtp_host', mailbox.smtp_host,
    'smtp_port', mailbox.smtp_port,
    'smtp_security', mailbox.smtp_security,
    'email_address', mailbox.email_address
  );
end;
$$;

drop function if exists public.read_mailbox_sync_credentials(uuid);

revoke all on function public.read_mailbox_sync_credentials(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.read_mailbox_sync_credentials(uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Shared quota guard
-- ---------------------------------------------------------------------------

create or replace function private.assert_email_send_quota(
  p_org_id uuid,
  p_mailbox_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used integer := 0;
  v_now_date date := (now() at time zone 'utc')::date;
begin
  select coalesce(quota.sent_count, 0)
  into v_used
  from public.email_send_quota_usage quota
  where quota.mailbox_account_id = p_mailbox_id
    and quota.usage_date = v_now_date;

  if v_used >= private.email_send_quota_limit() then
    raise exception 'Daily email send limit reached for this mailbox'
      using errcode = '55006';
  end if;
end;
$$;

revoke all on function private.assert_email_send_quota(uuid, uuid)
  from public, anon, authenticated;

create or replace function private.record_email_send(p_org_id uuid, p_mailbox_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now_date date := (now() at time zone 'utc')::date;
begin
  insert into public.email_send_quota_usage as quota (
    org_id,
    mailbox_account_id,
    usage_date,
    sent_count
  )
  values (
    p_org_id,
    p_mailbox_id,
    v_now_date,
    1
  )
  on conflict (mailbox_account_id, usage_date)
  do update set sent_count = quota.sent_count + 1;
end;
$$;

revoke all on function private.record_email_send(uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Begin (compose): validate mailbox + recipient + quota before claiming
-- ---------------------------------------------------------------------------

create or replace function public.begin_email_compose_idempotent(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_route text,
  p_ttl_seconds integer default 86400,
  p_to_address text default null,
  p_allow_external_recipients boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  membership_row public.memberships;
  mailbox public.mailbox_accounts;
  v_replay jsonb;
  v_exists boolean := false;
  v_entity_primary_email extensions.citext;
  v_to text;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  if p_entity_type not in ('contact', 'lead', 'client') then
    raise exception 'Invalid entity type'
      using errcode = '22023';
  end if;

  if p_to_address is not null
     and char_length(btrim(p_to_address)) > 320
  then
    raise exception 'Invalid recipient address'
      using errcode = '22023';
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

  if p_entity_type = 'contact' then
    select contacts.primary_email into v_entity_primary_email
    from public.contacts
    where contacts.id = p_entity_id
      and contacts.org_id = p_org_id
      and contacts.deleted_at is null;
    v_exists := v_entity_primary_email is not null
      or exists (
        select 1 from public.contacts
        where contacts.id = p_entity_id
          and contacts.org_id = p_org_id
          and contacts.deleted_at is null
      );
  elsif p_entity_type = 'lead' then
    select leads.primary_email into v_entity_primary_email
    from public.leads
    where leads.id = p_entity_id
      and leads.org_id = p_org_id
      and leads.deleted_at is null;
    v_exists := v_entity_primary_email is not null
      or exists (
        select 1 from public.leads
        where leads.id = p_entity_id
          and leads.org_id = p_org_id
          and leads.deleted_at is null
      );
  else
    select clients.primary_email into v_entity_primary_email
    from public.clients
    where clients.id = p_entity_id
      and clients.org_id = p_org_id
      and clients.deleted_at is null;
    v_exists := v_entity_primary_email is not null
      or exists (
        select 1 from public.clients
        where clients.id = p_entity_id
          and clients.org_id = p_org_id
          and clients.deleted_at is null
      );
  end if;

  if not v_exists then
    raise exception 'Entity not found'
      using errcode = 'P0002';
  end if;

  select * into mailbox
  from public.mailbox_accounts
  where mailbox_accounts.org_id = p_org_id
    and mailbox_accounts.membership_id = membership_row.id
    and mailbox_accounts.deleted_at is null;

  if mailbox.id is null then
    raise exception 'Mailbox not found'
      using errcode = 'P0002';
  end if;

  v_replay := private.idempotency_claim_or_replay(
    p_org_id, p_idempotency_key_hash, p_request_hash, p_route, p_ttl_seconds
  );
  if v_replay is not null then
    return v_replay;
  end if;

  perform private.assert_email_send_quota(p_org_id, mailbox.id);

  v_to := lower(btrim(coalesce(nullif(btrim(p_to_address), ''), coalesce(v_entity_primary_email::text, ''))));

  if v_to is null or char_length(v_to) = 0 then
    raise exception 'Recipient address is required'
      using errcode = '22023';
  end if;

  if v_to <> lower(trim(coalesce(v_entity_primary_email::text, ''))) then
    if not p_allow_external_recipients then
      raise exception 'Recipient must match the entity primary email'
        using errcode = '22023';
    end if;
    if membership_row.role not in ('owner', 'admin') then
      raise exception 'Only owners and admins may send to non-entity recipients'
        using errcode = '22023';
    end if;
  end if;

  return jsonb_build_object(
    'replay', false,
    'entity_type', p_entity_type,
    'entity_id', p_entity_id,
    'to_address', v_to,
    'mailbox', jsonb_build_object(
      'id', mailbox.id,
      'email_address', mailbox.email_address,
      'smtp_host', mailbox.smtp_host,
      'smtp_port', mailbox.smtp_port,
      'smtp_security', mailbox.smtp_security,
      'username', mailbox.username,
      'credentials_configured', mailbox.secret_ref is not null
    )
  );
end;
$$;

drop function if exists public.begin_email_compose_idempotent(
  uuid, text, uuid, text, text, text, integer
);

revoke all on function public.begin_email_compose_idempotent(
  uuid, text, uuid, text, text, text, integer, text, boolean
) from public, anon;
grant execute on function public.begin_email_compose_idempotent(
  uuid, text, uuid, text, text, text, integer, text, boolean
) to authenticated;

-- ---------------------------------------------------------------------------
-- Begin (reply): enforce the same daily quota before claiming
-- ---------------------------------------------------------------------------

create or replace function public.begin_email_reply_idempotent(
  p_org_id uuid,
  p_parent_message_id uuid,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_route text,
  p_ttl_seconds integer default 86400
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  membership_row public.memberships;
  message_row public.email_messages;
  mailbox public.mailbox_accounts;
  v_replay jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
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

  select * into message_row
  from public.email_messages
  where email_messages.id = p_parent_message_id
    and email_messages.org_id = p_org_id
    and email_messages.deleted_at is null;

  if message_row.id is null then
    raise exception 'Email message not found'
      using errcode = 'P0002';
  end if;

  if message_row.owner_membership_id <> membership_row.id then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  if message_row.direction <> 'inbound' then
    raise exception 'Parent message must be inbound'
      using errcode = '22023';
  end if;

  select * into mailbox
  from public.mailbox_accounts
  where mailbox_accounts.id = message_row.mailbox_account_id
    and mailbox_accounts.org_id = p_org_id
    and mailbox_accounts.deleted_at is null;

  if mailbox.id is null then
    raise exception 'Mailbox not found'
      using errcode = 'P0002';
  end if;

  if mailbox.membership_id <> membership_row.id then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  v_replay := private.idempotency_claim_or_replay(
    p_org_id, p_idempotency_key_hash, p_request_hash, p_route, p_ttl_seconds
  );
  if v_replay is not null then
    return v_replay;
  end if;

  perform private.assert_email_send_quota(p_org_id, mailbox.id);

  return jsonb_build_object(
    'replay', false,
    'parent', jsonb_build_object(
      'id', message_row.id,
      'from_address', message_row.from_address,
      'from_name', message_row.from_name,
      'subject', message_row.subject,
      'provider_message_id', message_row.provider_message_id,
      'thread_id', message_row.thread_id,
      'mailbox_account_id', message_row.mailbox_account_id,
      'owner_membership_id', message_row.owner_membership_id
    ),
    'mailbox', jsonb_build_object(
      'id', mailbox.id,
      'email_address', mailbox.email_address,
      'smtp_host', mailbox.smtp_host,
      'smtp_port', mailbox.smtp_port,
      'smtp_security', mailbox.smtp_security,
      'username', mailbox.username,
      'credentials_configured', mailbox.secret_ref is not null
    )
  );
end;
$$;

revoke all on function public.begin_email_reply_idempotent(
  uuid, uuid, text, text, text, integer
) from public, anon;
grant execute on function public.begin_email_reply_idempotent(
  uuid, uuid, text, text, text, integer
) to authenticated;

-- ---------------------------------------------------------------------------
-- Finish (compose): consume quota on success; audit off-CRM recipients
-- ---------------------------------------------------------------------------

create or replace function public.finish_email_compose_idempotent(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_to_address text,
  p_subject text,
  p_body_text text,
  p_body_html text,
  p_provider_message_id text,
  p_status text,
  p_failure_code text,
  p_idempotency_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  membership_row public.memberships;
  mailbox public.mailbox_accounts;
  thread_row public.email_threads;
  message_row public.email_messages;
  preview text;
  to_addrs jsonb;
  v_stored jsonb;
  v_flat jsonb;
  v_entity_primary_email extensions.citext;
  v_external_recipient boolean;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if p_status not in ('sent', 'failed') then
    raise exception 'Invalid outbound status'
      using errcode = '22023';
  end if;

  if p_status = 'sent' and coalesce(btrim(p_provider_message_id), '') = '' then
    raise exception 'Provider message id is required when status is sent'
      using errcode = '22023';
  end if;

  if p_failure_code is not null
     and char_length(p_failure_code) > 128
  then
    raise exception 'Invalid failure code'
      using errcode = '22023';
  end if;

  if p_entity_type not in ('contact', 'lead', 'client') then
    raise exception 'Invalid entity type'
      using errcode = '22023';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
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

  select * into mailbox
  from public.mailbox_accounts
  where mailbox_accounts.org_id = p_org_id
    and mailbox_accounts.membership_id = membership_row.id
    and mailbox_accounts.deleted_at is null;

  if mailbox.id is null then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  preview := left(coalesce(p_body_text, ''), 160);
  to_addrs := jsonb_build_array(
    jsonb_build_object(
      'email', lower(trim(p_to_address)),
      'name', null
    )
  );

  insert into public.email_threads (
    org_id,
    mailbox_account_id,
    owner_membership_id,
    provider_thread_id,
    subject_normalized,
    last_message_at,
    message_count
  )
  values (
    p_org_id,
    mailbox.id,
    membership_row.id,
    nullif(btrim(p_provider_message_id), ''),
    lower(coalesce(p_subject, '')),
    now(),
    0
  )
  returning * into thread_row;

  insert into public.email_messages (
    org_id,
    mailbox_account_id,
    owner_membership_id,
    thread_id,
    direction,
    status,
    provider,
    provider_message_id,
    in_reply_to_message_id,
    from_address,
    from_name,
    to_addresses,
    subject,
    body_text,
    body_html,
    preview_text,
    sent_at,
    failed_at,
    failure_code
  )
  values (
    p_org_id,
    mailbox.id,
    membership_row.id,
    thread_row.id,
    'outbound',
    p_status,
    'smtp',
    nullif(btrim(p_provider_message_id), ''),
    null,
    mailbox.email_address,
    null,
    to_addrs,
    coalesce(p_subject, ''),
    p_body_text,
    p_body_html,
    preview,
    case when p_status = 'sent' then now() else null end,
    case when p_status = 'failed' then now() else null end,
    case when p_status = 'failed' then nullif(btrim(p_failure_code), '') else null end
  )
  returning * into message_row;

  insert into public.email_message_links (
    org_id,
    message_id,
    entity_type,
    entity_id,
    link_reason,
    created_by
  )
  values (
    p_org_id,
    message_row.id,
    p_entity_type,
    p_entity_id,
    'address_match',
    actor_id
  )
  on conflict do nothing;

  update public.email_threads
  set
    last_message_at = now(),
    message_count = (
      select count(*)::integer from public.email_messages
      where email_messages.thread_id = thread_row.id
        and email_messages.deleted_at is null
    ),
    updated_at = now()
  where email_threads.id = thread_row.id;

  if p_status = 'sent' then
    perform private.record_email_send(p_org_id, mailbox.id);

    if p_entity_type = 'contact' then
      select contacts.primary_email into v_entity_primary_email
      from public.contacts
      where contacts.id = p_entity_id
        and contacts.org_id = p_org_id
        and contacts.deleted_at is null;
    elsif p_entity_type = 'lead' then
      select leads.primary_email into v_entity_primary_email
      from public.leads
      where leads.id = p_entity_id
        and leads.org_id = p_org_id
        and leads.deleted_at is null;
    else
      select clients.primary_email into v_entity_primary_email
      from public.clients
      where clients.id = p_entity_id
        and clients.org_id = p_org_id
        and clients.deleted_at is null;
    end if;

    v_external_recipient :=
      v_entity_primary_email is null
      or lower(trim(p_to_address)) <> lower(trim(v_entity_primary_email::text));

    if v_external_recipient then
      perform private.append_audit_event(
        p_org_id,
        'user',
        actor_id,
        'email.compose_external_recipient',
        'email_message',
        message_row.id,
        null,
        null,
        null,
        null,
        jsonb_build_object(
          'to_address', lower(trim(p_to_address)),
          'entity_type', p_entity_type,
          'entity_id', p_entity_id
        ),
        '{}'::jsonb
      );
    end if;
  end if;

  v_flat := jsonb_build_object(
    'id', message_row.id,
    'org_id', message_row.org_id,
    'mailbox_account_id', message_row.mailbox_account_id,
    'thread_id', message_row.thread_id,
    'direction', message_row.direction,
    'status', message_row.status,
    'provider', message_row.provider,
    'provider_message_id', message_row.provider_message_id,
    'in_reply_to_message_id', message_row.in_reply_to_message_id,
    'from_address', message_row.from_address,
    'to_addresses', message_row.to_addresses,
    'subject', message_row.subject,
    'body_text', message_row.body_text,
    'body_html', message_row.body_html,
    'preview_text', message_row.preview_text,
    'sent_at', message_row.sent_at,
    'failed_at', message_row.failed_at,
    'failure_code', message_row.failure_code,
    'created_at', message_row.created_at,
    'version', message_row.version
  );

  if p_status = 'sent' then
    v_stored := private.email_message_envelope(v_flat);
    perform private.idempotency_store_response(
      p_org_id,
      p_idempotency_key_hash,
      200,
      v_stored,
      'email_message',
      message_row.id
    );
    return jsonb_build_object(
      'replay', false,
      'response_status', 200,
      'response_body', v_stored -> 'body',
      'response_headers', v_stored -> 'headers'
    );
  end if;

  return jsonb_build_object(
    'replay', false,
    'response_status', 502,
    'response_body', jsonb_build_object(
      'data', v_flat,
      'error', jsonb_build_object(
        'code', 'SMTP_SEND_FAILED',
        'message', 'Outbound SMTP delivery failed',
        'failure_code', coalesce(p_failure_code, 'smtp_send_failed')
      )
    ),
    'response_headers', '{}'::jsonb
  );
end;
$$;

revoke all on function public.finish_email_compose_idempotent(
  uuid, text, uuid, text, text, text, text, text, text, text, text
) from public, anon;
grant execute on function public.finish_email_compose_idempotent(
  uuid, text, uuid, text, text, text, text, text, text, text, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- Finish (reply): consume quota on success
-- ---------------------------------------------------------------------------

create or replace function public.finish_email_reply_idempotent(
  p_org_id uuid,
  p_parent_message_id uuid,
  p_body_text text,
  p_body_html text,
  p_subject text,
  p_provider_message_id text,
  p_status text,
  p_failure_code text,
  p_idempotency_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  membership_row public.memberships;
  parent_row public.email_messages;
  mailbox public.mailbox_accounts;
  message_row public.email_messages;
  preview text;
  to_addrs jsonb;
  v_stored jsonb;
  v_flat jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if p_status not in ('sent', 'failed') then
    raise exception 'Invalid outbound status'
      using errcode = '22023';
  end if;

  if p_status = 'sent' and coalesce(btrim(p_provider_message_id), '') = '' then
    raise exception 'Provider message id is required when status is sent'
      using errcode = '22023';
  end if;

  if p_failure_code is not null
     and char_length(p_failure_code) > 128
  then
    raise exception 'Invalid failure code'
      using errcode = '22023';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
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

  select * into parent_row
  from public.email_messages
  where email_messages.id = p_parent_message_id
    and email_messages.org_id = p_org_id
    and email_messages.deleted_at is null;

  if parent_row.id is null then
    raise exception 'Email message not found'
      using errcode = 'P0002';
  end if;

  if parent_row.owner_membership_id <> membership_row.id
    or parent_row.direction <> 'inbound'
  then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  select * into mailbox
  from public.mailbox_accounts
  where mailbox_accounts.id = parent_row.mailbox_account_id
    and mailbox_accounts.org_id = p_org_id
    and mailbox_accounts.deleted_at is null;

  if mailbox.id is null or mailbox.membership_id <> membership_row.id then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  preview := left(coalesce(p_body_text, ''), 160);
  to_addrs := jsonb_build_array(
    jsonb_build_object(
      'email', parent_row.from_address,
      'name', parent_row.from_name
    )
  );

  insert into public.email_messages (
    org_id,
    mailbox_account_id,
    owner_membership_id,
    thread_id,
    direction,
    status,
    provider,
    provider_message_id,
    in_reply_to_message_id,
    from_address,
    from_name,
    to_addresses,
    subject,
    body_text,
    body_html,
    preview_text,
    sent_at,
    failed_at,
    failure_code
  )
  values (
    p_org_id,
    mailbox.id,
    membership_row.id,
    parent_row.thread_id,
    'outbound',
    p_status,
    'smtp',
    nullif(btrim(p_provider_message_id), ''),
    parent_row.id,
    mailbox.email_address,
    null,
    to_addrs,
    coalesce(p_subject, ''),
    p_body_text,
    p_body_html,
    preview,
    case when p_status = 'sent' then now() else null end,
    case when p_status = 'failed' then now() else null end,
    case when p_status = 'failed' then nullif(btrim(p_failure_code), '') else null end
  )
  returning * into message_row;

  if parent_row.thread_id is not null then
    update public.email_threads
    set
      last_message_at = greatest(email_threads.last_message_at, now()),
      message_count = (
        select count(*)::integer from public.email_messages
        where email_messages.thread_id = parent_row.thread_id
          and email_messages.deleted_at is null
      ),
      updated_at = now()
    where email_threads.id = parent_row.thread_id;
  end if;

  if p_status = 'sent' then
    perform private.record_email_send(p_org_id, mailbox.id);

    v_stored := private.email_message_envelope(jsonb_build_object(
      'id', message_row.id,
      'org_id', message_row.org_id,
      'mailbox_account_id', message_row.mailbox_account_id,
      'thread_id', message_row.thread_id,
      'direction', message_row.direction,
      'status', message_row.status,
      'provider', message_row.provider,
      'provider_message_id', message_row.provider_message_id,
      'in_reply_to_message_id', message_row.in_reply_to_message_id,
      'from_address', message_row.from_address,
      'to_addresses', message_row.to_addresses,
      'subject', message_row.subject,
      'body_text', message_row.body_text,
      'body_html', message_row.body_html,
      'preview_text', message_row.preview_text,
      'sent_at', message_row.sent_at,
      'failed_at', message_row.failed_at,
      'failure_code', message_row.failure_code,
      'created_at', message_row.created_at,
      'version', message_row.version
    ));
    perform private.idempotency_store_response(
      p_org_id,
      p_idempotency_key_hash,
      200,
      v_stored,
      'email_message',
      message_row.id
    );
    return jsonb_build_object(
      'replay', false,
      'response_status', 200,
      'response_body', v_stored -> 'body',
      'response_headers', v_stored -> 'headers'
    );
  end if;

  -- Failed attempt: leave claim for caller to abort (retryable).
  v_flat := jsonb_build_object(
    'id', message_row.id,
    'org_id', message_row.org_id,
    'mailbox_account_id', message_row.mailbox_account_id,
    'thread_id', message_row.thread_id,
    'direction', message_row.direction,
    'status', message_row.status,
    'provider', message_row.provider,
    'provider_message_id', message_row.provider_message_id,
    'in_reply_to_message_id', message_row.in_reply_to_message_id,
    'from_address', message_row.from_address,
    'to_addresses', message_row.to_addresses,
    'subject', message_row.subject,
    'body_text', message_row.body_text,
    'body_html', message_row.body_html,
    'preview_text', message_row.preview_text,
    'sent_at', message_row.sent_at,
    'failed_at', message_row.failed_at,
    'failure_code', message_row.failure_code,
    'created_at', message_row.created_at,
    'version', message_row.version
  );

  return jsonb_build_object(
    'replay', false,
    'response_status', 502,
    'response_body', jsonb_build_object(
      'data', v_flat,
      'error', jsonb_build_object(
        'code', 'SMTP_SEND_FAILED',
        'message', 'Outbound SMTP delivery failed',
        'failure_code', coalesce(p_failure_code, 'smtp_send_failed')
      )
    ),
    'response_headers', '{}'::jsonb
  );
end;
$$;

revoke all on function public.finish_email_reply_idempotent(
  uuid, uuid, text, text, text, text, text, text, text
) from public, anon;
grant execute on function public.finish_email_reply_idempotent(
  uuid, uuid, text, text, text, text, text, text, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- AI compose suggestion: cap stored payload sizes (server-side validation)
-- ---------------------------------------------------------------------------

create or replace function public.create_email_compose_suggestion(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_output_text text,
  p_model_provider text,
  p_model_name text,
  p_variant text default 'neutral',
  p_prompt_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  v_exists boolean := false;
  suggestion public.ai_suggestions;
  output text;
  variant text := coalesce(nullif(trim(p_variant), ''), 'neutral');
  prompt_version text;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  if p_entity_type not in ('contact', 'lead', 'client') then
    raise exception 'Invalid entity type'
      using errcode = '22023';
  end if;

  if p_entity_type = 'contact' then
    select exists (
      select 1 from public.contacts
      where contacts.id = p_entity_id
        and contacts.org_id = p_org_id
        and contacts.deleted_at is null
    ) into v_exists;
  elsif p_entity_type = 'lead' then
    select exists (
      select 1 from public.leads
      where leads.id = p_entity_id
        and leads.org_id = p_org_id
        and leads.deleted_at is null
    ) into v_exists;
  else
    select exists (
      select 1 from public.clients
      where clients.id = p_entity_id
        and clients.org_id = p_org_id
        and clients.deleted_at is null
    ) into v_exists;
  end if;

  if not v_exists then
    raise exception 'Entity not found'
      using errcode = 'P0002';
  end if;

  if p_output_text is null or length(trim(p_output_text)) = 0 then
    raise exception 'output_text is required'
      using errcode = '22023';
  end if;

  if char_length(p_output_text) > 20000 then
    raise exception 'output_text is too long'
      using errcode = '22023';
  end if;

  if p_model_provider is not null and char_length(p_model_provider) > 64 then
    raise exception 'model_provider is too long'
      using errcode = '22023';
  end if;

  if p_model_name is not null and char_length(p_model_name) > 128 then
    raise exception 'model_name is too long'
      using errcode = '22023';
  end if;

  output := p_output_text;
  prompt_version := coalesce(nullif(trim(p_prompt_version), ''), 'ai-prompts-v1');

  insert into public.ai_suggestions (
    org_id, kind, entity_type, entity_id, status, variant,
    prompt_version, model_provider, model_name, output_text,
    created_by, updated_by
  )
  values (
    p_org_id, 'email_compose', p_entity_type, p_entity_id, 'ready',
    variant, prompt_version, left(coalesce(p_model_provider, ''), 64),
    left(coalesce(p_model_name, ''), 128),
    output, actor_id, actor_id
  )
  returning * into suggestion;

  return jsonb_build_object(
    'id', suggestion.id,
    'kind', suggestion.kind,
    'status', suggestion.status,
    'variant', suggestion.variant,
    'prompt_version', suggestion.prompt_version,
    'model_provider', suggestion.model_provider,
    'model_name', suggestion.model_name,
    'output_text', suggestion.output_text,
    'entity_type', suggestion.entity_type,
    'entity_id', suggestion.entity_id,
    'created_at', suggestion.created_at
  );
end;
$$;

revoke all on function public.create_email_compose_suggestion(
  uuid, text, uuid, text, text, text, text, text
) from public, anon;
grant execute on function public.create_email_compose_suggestion(
  uuid, text, uuid, text, text, text, text, text
) to authenticated;

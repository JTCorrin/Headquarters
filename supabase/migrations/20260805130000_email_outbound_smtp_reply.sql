-- Email outbound SMTP reply-first: extend sync credentials with smtp_*,
-- begin/finish/abort idempotent reply RPCs, outbound insert helper.

-- ---------------------------------------------------------------------------
-- Credential read: IMAP + SMTP (+ shared password)
-- ---------------------------------------------------------------------------

create or replace function public.read_mailbox_sync_credentials(p_mailbox_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  mailbox public.mailbox_accounts;
  password text;
begin
  select * into mailbox
  from public.mailbox_accounts
  where mailbox_accounts.id = p_mailbox_id
    and mailbox_accounts.deleted_at is null;

  if mailbox.id is null then
    raise exception 'Mailbox not found'
      using errcode = 'P0002';
  end if;

  if mailbox.secret_ref is null then
    return jsonb_build_object(
      'password', null,
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

  return jsonb_build_object(
    'password', password,
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

revoke all on function public.read_mailbox_sync_credentials(uuid)
  from public, anon, authenticated;
grant execute on function public.read_mailbox_sync_credentials(uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Flatten outbound message for Edge response + idempotency store
-- ---------------------------------------------------------------------------

create or replace function private.email_message_envelope(p_message jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_headers jsonb;
  v_body jsonb;
begin
  v_headers := '{}'::jsonb;
  v_body := jsonb_build_object(
    'status', 200,
    'body', jsonb_build_object('data', p_message),
    'headers', v_headers
  );
  return v_body;
end;
$$;

revoke all on function private.email_message_envelope(jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Begin: claim Idempotency-Key + load inbound parent (owner-only)
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

  v_replay := private.idempotency_claim_or_replay(
    p_org_id, p_idempotency_key_hash, p_request_hash, p_route, p_ttl_seconds
  );
  if v_replay is not null then
    return v_replay;
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
-- Abort in-progress claim (SMTP / validation failure before success store)
-- ---------------------------------------------------------------------------

create or replace function public.abort_email_reply_idempotent(
  p_org_id uuid,
  p_idempotency_key_hash text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
begin
  if v_actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  delete from public.api_idempotency_keys
  where api_idempotency_keys.org_id = p_org_id
    and api_idempotency_keys.actor_type = 'user'
    and api_idempotency_keys.actor_id = v_actor_id
    and api_idempotency_keys.idempotency_key_hash = p_idempotency_key_hash
    and api_idempotency_keys.response_status is null;
end;
$$;

revoke all on function public.abort_email_reply_idempotent(uuid, text)
  from public, anon;
grant execute on function public.abort_email_reply_idempotent(uuid, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Finish: insert outbound row (+ thread bump) and store success envelope
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

  -- Only successful SMTP deliveries are stored for Idempotency-Key replay.
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

  -- Failed attempt: leave claim for caller to abort (retryable).
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

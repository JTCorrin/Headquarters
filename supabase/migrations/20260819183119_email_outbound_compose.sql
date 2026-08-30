-- New-email compose from entity views: idempotent SMTP send without a parent
-- message, plus AI compose suggestions keyed to contact/lead/client.

-- ---------------------------------------------------------------------------
-- ai_suggestions: allow email_compose kind and invoice entity_type
-- ---------------------------------------------------------------------------

do $$
declare
  rec record;
begin
  for rec in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'ai_suggestions'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%kind%'
  loop
    execute format('alter table public.ai_suggestions drop constraint %I', rec.conname);
  end loop;

  for rec in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'ai_suggestions'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%entity_type%'
  loop
    execute format('alter table public.ai_suggestions drop constraint %I', rec.conname);
  end loop;
end
$$;

alter table public.ai_suggestions
  add constraint ai_suggestions_kind_check
  check (kind in ('email_reply', 'invoice_chase', 'quote_cover', 'email_compose'));

alter table public.ai_suggestions
  add constraint ai_suggestions_entity_type_check
  check (entity_type in ('contact', 'lead', 'client', 'email_message', 'invoice'));

-- ---------------------------------------------------------------------------
-- Begin: claim Idempotency-Key + load caller mailbox + verify entity
-- ---------------------------------------------------------------------------

create or replace function public.begin_email_compose_idempotent(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id uuid,
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
  mailbox public.mailbox_accounts;
  v_replay jsonb;
  v_exists boolean := false;
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

  v_replay := private.idempotency_claim_or_replay(
    p_org_id, p_idempotency_key_hash, p_request_hash, p_route, p_ttl_seconds
  );
  if v_replay is not null then
    return v_replay;
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

  return jsonb_build_object(
    'replay', false,
    'entity_type', p_entity_type,
    'entity_id', p_entity_id,
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

revoke all on function public.begin_email_compose_idempotent(
  uuid, text, uuid, text, text, text, integer
) from public, anon;
grant execute on function public.begin_email_compose_idempotent(
  uuid, text, uuid, text, text, text, integer
) to authenticated;

create or replace function public.abort_email_compose_idempotent(
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

revoke all on function public.abort_email_compose_idempotent(uuid, text)
  from public, anon;
grant execute on function public.abort_email_compose_idempotent(uuid, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Finish: insert outbound + entity link + optional new thread
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
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if p_status not in ('sent', 'failed') then
    raise exception 'Invalid outbound status'
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
-- AI compose suggestion (entity-scoped, no parent message)
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

  output := p_output_text;
  prompt_version := coalesce(nullif(trim(p_prompt_version), ''), 'ai-prompts-v1');

  insert into public.ai_suggestions (
    org_id, kind, entity_type, entity_id, status, variant,
    prompt_version, model_provider, model_name, output_text,
    created_by, updated_by
  )
  values (
    p_org_id, 'email_compose', p_entity_type, p_entity_id, 'ready',
    variant, prompt_version, p_model_provider, p_model_name,
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

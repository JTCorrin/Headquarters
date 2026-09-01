-- 1) send_invoice(uuid,uuid,integer) collided with the 5-arg form that has defaults,
--    so 3-arg calls raised "function is not unique". Keep one overload with defaults.
-- 2) finish_email_reply_idempotent lost parent email_message_links copy when rewritten
--    for send-quota accounting; restore that insert so entity Email tabs stay linked.

drop function if exists public.send_invoice(uuid, uuid, integer);

create or replace function public.send_invoice(
  p_invoice_id uuid,
  p_org_id uuid,
  p_expected_version integer,
  p_sent_at timestamptz default null,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  invoice_row public.invoices;
  snapshot jsonb;
  lines_json jsonb;
  effective_sent_at timestamptz := coalesce(p_sent_at, now());
begin
  actor_id := private.resolve_org_actor(p_org_id, p_actor_id);

  select * into invoice_row
  from public.invoices
  where invoices.id = p_invoice_id
    and invoices.org_id = p_org_id
    and invoices.deleted_at is null
  for update;

  if not found then
    raise exception 'Invoice not found'
      using errcode = 'P0002';
  end if;

  if invoice_row.version is distinct from p_expected_version then
    raise exception 'Invoice version conflict'
      using errcode = 'P0001';
  end if;

  if invoice_row.status <> 'draft' then
    raise exception 'Only draft invoices can be sent'
      using errcode = '22023';
  end if;

  if invoice_row.source = 'quote'
    and invoice_row.party_snapshot ? 'client'
    and invoice_row.party_snapshot ? 'contacts'
  then
    snapshot := invoice_row.party_snapshot;
  else
    snapshot := private.build_receivable_party_snapshot(
      p_org_id,
      invoice_row.client_id,
      invoice_row.contact_id,
      private.invoice_recipient_contact_ids(p_org_id, invoice_row.id)
    );
  end if;

  perform set_config('app.allow_invoice_lifecycle', 'on', true);

  update public.invoices
  set
    status = 'sent',
    party_snapshot = snapshot,
    balance_due_cents = invoices.total_cents - invoices.paid_cents,
    sent_at = effective_sent_at,
    updated_by = actor_id
  where invoices.id = invoice_row.id
  returning * into invoice_row;

  perform set_config('app.allow_invoice_lifecycle', 'off', true);

  select coalesce(
    jsonb_agg(to_jsonb(invoice_lines) order by invoice_lines.position, invoice_lines.id),
    '[]'::jsonb
  )
  into lines_json
  from public.invoice_lines
  where invoice_lines.invoice_id = invoice_row.id;

  perform private.append_timeline_event(
    invoice_row.org_id,
    'invoice',
    invoice_row.id,
    'status',
    'Invoice sent',
    null,
    actor_id,
    'invoice',
    invoice_row.id,
    jsonb_build_object(
      'action', 'invoice.sent',
      'invoice_id', invoice_row.id,
      'number', invoice_row.number,
      'client_id', invoice_row.client_id
    )
  );

  perform private.append_timeline_event(
    invoice_row.org_id,
    'client',
    invoice_row.client_id,
    'status',
    'Invoice sent',
    format('Invoice %s', invoice_row.number),
    actor_id,
    'invoice',
    invoice_row.id,
    jsonb_build_object(
      'action', 'invoice.sent',
      'invoice_id', invoice_row.id,
      'number', invoice_row.number,
      'client_id', invoice_row.client_id
    )
  );

  return jsonb_build_object(
    'invoice', to_jsonb(invoice_row),
    'lines', lines_json,
    'recipients', private.invoice_recipients_json(p_org_id, invoice_row.id)
  );
end;
$$;

revoke all on function public.send_invoice(uuid, uuid, integer, timestamptz, uuid)
  from public, anon;
grant execute on function public.send_invoice(uuid, uuid, integer, timestamptz, uuid)
  to authenticated, service_role;

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

  -- Entity rails list via email_message_links only — copy parent's links so the
  -- outbound reply appears on the same contact/lead/client Email tabs.
  insert into public.email_message_links (
    org_id,
    message_id,
    entity_type,
    entity_id,
    link_reason,
    created_by
  )
  select
    l.org_id,
    message_row.id,
    l.entity_type,
    l.entity_id,
    l.link_reason,
    actor_id
  from public.email_message_links l
  where l.org_id = p_org_id
    and l.message_id = parent_row.id
  on conflict do nothing;

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

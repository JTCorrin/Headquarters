-- Client email reply visibility: copy parent email_message_links onto outbound
-- replies, and expose sent_at / to_addresses on entity email list envelope.

-- ---------------------------------------------------------------------------
-- finish_email_reply_idempotent: insert outbound + copy parent links
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

-- ---------------------------------------------------------------------------
-- list_entity_email_messages: add sent_at + to_addresses for outbound display
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

  -- One row per message: prefer timeline_share over address_match when both exist.
  select coalesce(jsonb_agg(limited.item order by limited.sort_at desc), '[]'::jsonb)
  into rows
  from (
    select deduped.item, deduped.sort_at
    from (
      select distinct on (m.id)
        jsonb_build_object(
          'id', m.id,
          'subject', m.subject,
          'from_address', m.from_address,
          'from_name', m.from_name,
          'to_addresses', m.to_addresses,
          'preview_text', m.preview_text,
          'body_text', case
            when m.owner_membership_id = membership_row.id then m.body_text
            when l.link_reason = 'timeline_share' then m.body_text
            else null
          end,
          'received_at', m.received_at,
          'sent_at', m.sent_at,
          'direction', m.direction,
          'link_reason', l.link_reason,
          'is_owner', (m.owner_membership_id = membership_row.id)
        ) as item,
        coalesce(m.sent_at, m.received_at, m.created_at) as sort_at
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
      order by
        m.id,
        case when l.link_reason = 'timeline_share' then 0 else 1 end,
        coalesce(m.sent_at, m.received_at, m.created_at) desc
    ) deduped
    order by deduped.sort_at desc
    limit greatest(least(p_limit, 200), 1)
  ) limited;

  return rows;
end;
$$;

revoke all on function public.list_entity_email_messages(uuid, text, uuid, integer) from public, anon;
grant execute on function public.list_entity_email_messages(uuid, text, uuid, integer) to authenticated;

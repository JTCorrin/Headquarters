-- Wave B: owner-only AI writes, sync helpers, share→timeline, ai_suggestions.

set search_path = public, extensions, pg_catalog;

-- ---------------------------------------------------------------------------
-- Owner-only AI connect/disconnect (tighten Wave A owner/admin → owner)
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

  if not private.has_org_role(p_org_id, array['owner']) then
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
      org_id, type, name, status, config, secret_ref, connected_by,
      credentials_updated_at, created_by, updated_by
    )
    values (
      p_org_id, integration_type, display_name, 'active',
      jsonb_build_object('provider', p_provider, 'auth_mode', 'api_key'),
      new_secret, actor_id, now(), actor_id, actor_id
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

  if not private.has_org_role(p_org_id, array['owner']) then
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

-- ---------------------------------------------------------------------------
-- ai_suggestions
-- ---------------------------------------------------------------------------

create table public.ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  kind text not null check (kind in ('email_reply', 'invoice_chase', 'quote_cover')),
  entity_type text not null check (entity_type in ('contact', 'lead', 'client', 'email_message')),
  entity_id uuid not null,
  status text not null default 'generating'
    check (status in ('generating', 'ready', 'accepted', 'discarded', 'failed')),
  variant text,
  prompt_version text,
  model_provider text,
  model_name text,
  input_hash text,
  output_text text,
  accepted_text text,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  error_code text,
  source_email_message_id uuid,
  constraint ai_suggestions_org_id_id_key unique (org_id, id),
  constraint ai_suggestions_source_email_fk
    foreign key (org_id, source_email_message_id)
    references public.email_messages (org_id, id)
    on delete set null (source_email_message_id)
);

create index ai_suggestions_org_entity_idx
  on public.ai_suggestions (org_id, entity_type, entity_id)
  where deleted_at is null;

create trigger ai_suggestions_stamp_business_row
before insert or update on public.ai_suggestions
for each row execute function private.stamp_business_row();

alter table public.ai_suggestions enable row level security;
revoke all on table public.ai_suggestions from public, anon, authenticated;
grant select on table public.ai_suggestions to authenticated;

create policy ai_suggestions_select_member on public.ai_suggestions
for select to authenticated
using (
  deleted_at is null
  and private.has_org_role(org_id, array['owner', 'admin', 'member', 'readonly'])
);

-- ---------------------------------------------------------------------------
-- Sync lease + ingest helpers (service / security definer)
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
    'credentials_configured', (mailbox.secret_ref is not null)
  );
end;
$$;

create or replace function public.release_mailbox_sync_lease(
  p_mailbox_id uuid,
  p_holder text,
  p_ok boolean,
  p_error_code text default null,
  p_auth_failed boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  mailbox public.mailbox_accounts;
  fails integer;
begin
  select * into mailbox
  from public.mailbox_accounts
  where mailbox_accounts.id = p_mailbox_id
    and mailbox_accounts.deleted_at is null
  for update;

  if mailbox.id is null then
    return;
  end if;

  if mailbox.sync_lease_holder is distinct from p_holder then
    return;
  end if;

  fails := mailbox.consecutive_auth_failures;
  if p_auth_failed then
    fails := fails + 1;
  elsif p_ok then
    fails := 0;
  end if;

  update public.mailbox_accounts
  set
    sync_lease_until = null,
    sync_lease_holder = null,
    last_checked_at = now(),
    last_error_code = case when p_ok then null else coalesce(p_error_code, mailbox.last_error_code) end,
    consecutive_auth_failures = fails,
    status = case
      when fails >= 3 then 'error'
      when p_ok then 'active'
      else coalesce(nullif(mailbox.status, 'disabled'), 'active')
    end,
    updated_at = now()
  where mailbox_accounts.id = mailbox.id;
end;
$$;

create or replace function public.list_mailboxes_due_for_sync(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rows jsonb;
begin
  -- LIMIT must apply to candidate rows before jsonb_agg (aggregate collapses to one row).
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'org_id', m.org_id,
    'membership_id', m.membership_id,
    'imap_host', m.imap_host,
    'status', m.status,
    'consecutive_auth_failures', m.consecutive_auth_failures
  ) order by m.last_checked_at nulls first), '[]'::jsonb)
  into rows
  from (
    select *
    from public.mailbox_accounts candidate
    where candidate.deleted_at is null
      and candidate.secret_ref is not null
      and candidate.status in ('pending', 'active', 'error')
      and candidate.consecutive_auth_failures < 3
      and (candidate.sync_lease_until is null or candidate.sync_lease_until < now())
    order by candidate.last_checked_at nulls first
    limit greatest(p_limit, 1)
  ) m;

  return rows;
end;
$$;

-- Upsert one inbound message + exact-address soft links (address_match).
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
  p_body_truncated boolean default false
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
  match_address extensions.citext;
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
      from_address, from_name, to_addresses, subject,
      body_text, preview_text, body_truncated, received_at
    )
    values (
      p_org_id, mailbox.id, mailbox.membership_id, thread_row.id,
      'inbound', 'received', 'imap', p_provider_message_id,
      lower(trim(p_from_address)), nullif(trim(p_from_name), ''),
      coalesce(p_to_addresses, '[]'::jsonb), coalesce(p_subject, ''),
      p_body_text, p_preview_text, coalesce(p_body_truncated, false),
      coalesce(p_received_at, now())
    )
    returning * into message_row;
  else
    update public.email_messages
    set
      subject = coalesce(p_subject, email_messages.subject),
      body_text = coalesce(p_body_text, email_messages.body_text),
      preview_text = coalesce(p_preview_text, email_messages.preview_text),
      body_truncated = coalesce(p_body_truncated, email_messages.body_truncated),
      updated_at = now()
    where email_messages.id = message_row.id
    returning * into message_row;
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

  -- Exact-address match against contact/lead/client primary_email (from or to).
  for match_address in
    select distinct lower(addr) as addr
    from (
      select lower(trim(p_from_address)) as addr
      union all
      select lower(trim(x.email))
      from jsonb_array_elements(coalesce(p_to_addresses, '[]'::jsonb)) e
      cross join lateral (select e ->> 'email' as email) x
      where nullif(trim(x.email), '') is not null
    ) addrs
    where addr is not null and addr <> ''
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
    where l.org_id = p_org_id
      and l.deleted_at is null
      and l.primary_email = match_address
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
  end loop;

  return jsonb_build_object(
    'id', message_row.id,
    'thread_id', message_row.thread_id,
    'provider_message_id', message_row.provider_message_id,
    'owner_membership_id', message_row.owner_membership_id
  );
end;
$$;

-- Share message to entity timeline (full body).
create or replace function public.share_email_message_to_timeline(
  p_org_id uuid,
  p_message_id uuid,
  p_entity_type text,
  p_entity_id uuid
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
  link_row public.email_message_links;
  timeline_id uuid;
  entity_ok boolean := false;
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

  if p_entity_type not in ('contact', 'lead', 'client') then
    raise exception 'Invalid entity type'
      using errcode = '22023';
  end if;

  select * into message_row
  from public.email_messages
  where email_messages.id = p_message_id
    and email_messages.org_id = p_org_id
    and email_messages.deleted_at is null
  for update;

  if message_row.id is null then
    raise exception 'Email message not found'
      using errcode = 'P0002';
  end if;

  if message_row.owner_membership_id <> membership_row.id then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  if p_entity_type = 'contact' then
    select exists (
      select 1 from public.contacts
      where contacts.id = p_entity_id and contacts.org_id = p_org_id and contacts.deleted_at is null
    ) into entity_ok;
  elsif p_entity_type = 'lead' then
    select exists (
      select 1 from public.leads
      where leads.id = p_entity_id and leads.org_id = p_org_id and leads.deleted_at is null
    ) into entity_ok;
  else
    select exists (
      select 1 from public.clients
      where clients.id = p_entity_id and clients.org_id = p_org_id and clients.deleted_at is null
    ) into entity_ok;
  end if;

  if not entity_ok then
    raise exception 'Entity not found'
      using errcode = 'P0002';
  end if;

  insert into public.email_message_links (
    org_id, message_id, entity_type, entity_id, link_reason, created_by
  )
  values (
    p_org_id, message_row.id, p_entity_type, p_entity_id, 'timeline_share', actor_id
  )
  on conflict (message_id, entity_type, entity_id, link_reason) do update
    set created_by = coalesce(email_message_links.created_by, excluded.created_by)
  returning * into link_row;

  insert into public.timeline_events (
    org_id, entity_type, entity_id, kind, title, body,
    actor_type, actor_id, source_type, source_id, payload, occurred_at
  )
  values (
    p_org_id,
    p_entity_type,
    p_entity_id,
    'email',
    coalesce(nullif(trim(message_row.subject), ''), '(no subject)'),
    message_row.body_text,
    'user',
    actor_id,
    'email_message',
    message_row.id,
    jsonb_build_object(
      'email_message_id', message_row.id,
      'direction', message_row.direction,
      'from_address', message_row.from_address,
      'from_name', message_row.from_name,
      'to_addresses', message_row.to_addresses,
      'preview_text', message_row.preview_text,
      'body_text', message_row.body_text,
      'shared', true
    ),
    coalesce(message_row.received_at, message_row.sent_at, now())
  )
  returning id into timeline_id;

  return jsonb_build_object(
    'link_id', link_row.id,
    'timeline_event_id', timeline_id,
    'message_id', message_row.id,
    'entity_type', p_entity_type,
    'entity_id', p_entity_id
  );
end;
$$;

-- AI suggestion lifecycle
create or replace function public.create_email_reply_suggestion(
  p_org_id uuid,
  p_message_id uuid,
  p_output_text text,
  p_model_provider text,
  p_model_name text,
  p_variant text default 'neutral'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  message_row public.email_messages;
  suggestion public.ai_suggestions;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  select * into message_row
  from public.email_messages
  where email_messages.id = p_message_id
    and email_messages.org_id = p_org_id
    and email_messages.deleted_at is null;

  if message_row.id is null then
    raise exception 'Email message not found'
      using errcode = 'P0002';
  end if;

  insert into public.ai_suggestions (
    org_id, kind, entity_type, entity_id, status, variant,
    prompt_version, model_provider, model_name, output_text,
    source_email_message_id, created_by, updated_by
  )
  values (
    p_org_id, 'email_reply', 'email_message', p_message_id, 'ready',
    coalesce(p_variant, 'neutral'), 'wave-b-v1', p_model_provider, p_model_name,
    p_output_text, p_message_id, actor_id, actor_id
  )
  returning * into suggestion;

  return jsonb_build_object(
    'id', suggestion.id,
    'kind', suggestion.kind,
    'status', suggestion.status,
    'variant', suggestion.variant,
    'model_provider', suggestion.model_provider,
    'model_name', suggestion.model_name,
    'output_text', suggestion.output_text,
    'source_email_message_id', suggestion.source_email_message_id,
    'created_at', suggestion.created_at
  );
end;
$$;

create or replace function public.decide_ai_suggestion(
  p_org_id uuid,
  p_suggestion_id uuid,
  p_decision text,
  p_accepted_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  suggestion public.ai_suggestions;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  if p_decision not in ('use', 'discard') then
    raise exception 'Invalid decision'
      using errcode = '22023';
  end if;

  select * into suggestion
  from public.ai_suggestions
  where ai_suggestions.id = p_suggestion_id
    and ai_suggestions.org_id = p_org_id
    and ai_suggestions.deleted_at is null
  for update;

  if suggestion.id is null then
    raise exception 'Suggestion not found'
      using errcode = 'P0002';
  end if;

  if suggestion.status <> 'ready' then
    raise exception 'Suggestion is not ready'
      using errcode = '22023';
  end if;

  update public.ai_suggestions
  set
    status = case when p_decision = 'use' then 'accepted' else 'discarded' end,
    accepted_text = case
      when p_decision = 'use' then coalesce(p_accepted_text, suggestion.output_text)
      else null
    end,
    decided_by = actor_id,
    decided_at = now(),
    updated_by = actor_id,
    version = suggestion.version + 1
  where ai_suggestions.id = suggestion.id
  returning * into suggestion;

  return jsonb_build_object(
    'id', suggestion.id,
    'status', suggestion.status,
    'accepted_text', suggestion.accepted_text,
    'output_text', suggestion.output_text,
    'decided_at', suggestion.decided_at
  );
end;
$$;

-- Grants
revoke all on function public.claim_mailbox_sync_lease(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.claim_mailbox_sync_lease(uuid, text, integer) to service_role;

revoke all on function public.release_mailbox_sync_lease(uuid, text, boolean, text, boolean) from public, anon, authenticated;
grant execute on function public.release_mailbox_sync_lease(uuid, text, boolean, text, boolean) to service_role;

revoke all on function public.list_mailboxes_due_for_sync(integer) from public, anon, authenticated;
grant execute on function public.list_mailboxes_due_for_sync(integer) to service_role;

revoke all on function public.upsert_inbound_email_message(
  uuid, uuid, text, text, text, text, jsonb, text, text, text, timestamptz, boolean
) from public, anon, authenticated;
grant execute on function public.upsert_inbound_email_message(
  uuid, uuid, text, text, text, text, jsonb, text, text, text, timestamptz, boolean
) to service_role;

-- Also allow authenticated owner membership sync trigger via edge (user JWT + service for ingest).
-- Share + suggestions use authenticated.
revoke all on function public.share_email_message_to_timeline(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.share_email_message_to_timeline(uuid, uuid, text, uuid) to authenticated;

revoke all on function public.create_email_reply_suggestion(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.create_email_reply_suggestion(uuid, uuid, text, text, text, text) to authenticated;

revoke all on function public.decide_ai_suggestion(uuid, uuid, text, text) from public, anon;
grant execute on function public.decide_ai_suggestion(uuid, uuid, text, text) to authenticated;

-- Manual sync for mailbox owner (calls same ingest path via edge; lease claim via service).
-- Expose a thin authenticated helper to list own messages for entity tab (Wave B list).
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
          'preview_text', m.preview_text,
          'body_text', case
            when m.owner_membership_id = membership_row.id then m.body_text
            when l.link_reason = 'timeline_share' then m.body_text
            else null
          end,
          'received_at', m.received_at,
          'direction', m.direction,
          'link_reason', l.link_reason,
          'is_owner', (m.owner_membership_id = membership_row.id)
        ) as item,
        coalesce(m.received_at, m.created_at) as sort_at
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
        coalesce(m.received_at, m.created_at) desc
    ) deduped
    order by deduped.sort_at desc
    limit greatest(least(p_limit, 200), 1)
  ) limited;

  return rows;
end;
$$;

revoke all on function public.list_entity_email_messages(uuid, text, uuid, integer) from public, anon;
grant execute on function public.list_entity_email_messages(uuid, text, uuid, integer) to authenticated;

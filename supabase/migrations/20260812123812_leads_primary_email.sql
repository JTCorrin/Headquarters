-- Leads get primary_email (parity with contacts/clients) so inbox matching,
-- convert, and playbook email resolve work without requiring a linked contact.

set search_path = public, extensions, pg_catalog;

alter table public.leads
  add column if not exists primary_email extensions.citext;

comment on column public.leads.primary_email is
  'Optional primary email for the lead; used for inbox address matching and convert.';

create index if not exists leads_org_email_idx
  on public.leads (org_id, primary_email)
  where deleted_at is null and primary_email is not null;

grant insert (
  org_id,
  name,
  company_name,
  primary_email,
  contact_id,
  client_id,
  stage,
  value_cents,
  currency,
  probability_percent,
  source,
  owner_membership_id,
  expected_close_on,
  lost_reason,
  position,
  notes,
  metadata
) on table public.leads to authenticated;

grant update (
  name,
  company_name,
  primary_email,
  contact_id,
  client_id,
  stage,
  value_cents,
  currency,
  probability_percent,
  source,
  owner_membership_id,
  expected_close_on,
  lost_reason,
  lost_at,
  position,
  notes,
  metadata,
  deleted_at
) on table public.leads to authenticated;

-- Match leads on own primary_email as well as linked contact email.
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
    is_new := true;
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

  -- Exact-address match (from or to): contacts + clients on primary_email;
  -- leads on own primary_email or linked contact.primary_email.
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
  end loop;

  return jsonb_build_object(
    'id', message_row.id,
    'thread_id', message_row.thread_id,
    'provider_message_id', message_row.provider_message_id,
    'owner_membership_id', message_row.owner_membership_id
  );
end;
$$;

revoke all on function public.upsert_inbound_email_message(
  uuid, uuid, text, text, text, text, jsonb, text, text, text, timestamptz, boolean
) from public, anon, authenticated;
grant execute on function public.upsert_inbound_email_message(
  uuid, uuid, text, text, text, text, jsonb, text, text, text, timestamptz, boolean
) to service_role;

-- Prefer contact email, fall back to lead.primary_email when creating a client.
create or replace function public.convert_lead(
  p_lead_id uuid,
  p_client_name text default null,
  p_client_status text default 'active'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  lead_row public.leads;
  client_row public.clients;
  contact_row public.contacts;
  client_name text;
  client_status text := coalesce(nullif(trim(p_client_status), ''), 'active');
  contact_email text;
  contact_phone text;
  now_ts timestamptz := now();
  reused_client boolean := false;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if client_status not in ('prospect', 'active', 'on_hold', 'inactive', 'archived') then
    raise exception 'Client status is invalid'
      using errcode = '22023';
  end if;

  select * into lead_row
  from public.leads
  where leads.id = p_lead_id
    and leads.deleted_at is null
  for update;

  if not found then
    raise exception 'Lead not found'
      using errcode = 'P0002';
  end if;

  if not private.has_org_role(
    lead_row.org_id,
    array['owner', 'admin', 'member']
  ) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  if lead_row.stage = 'won' then
    if lead_row.client_id is null
      or lead_row.won_at is null
      or lead_row.converted_at is null
    then
      raise exception 'Converted lead is in an inconsistent state'
        using errcode = '23514';
    end if;

    select * into client_row
    from public.clients
    where clients.id = lead_row.client_id
      and clients.org_id = lead_row.org_id
    for update;

    if not found then
      raise exception 'Converted lead is missing its client'
        using errcode = 'P0002';
    end if;

    if client_row.deleted_at is not null then
      update public.clients
      set
        deleted_at = null,
        updated_by = actor_id
      where clients.id = client_row.id
      returning * into client_row;
    end if;

    if lead_row.contact_id is not null then
      -- Validate without pre-locking; helper owns the ordered contact lock set.
      select * into contact_row
      from public.contacts
      where contacts.id = lead_row.contact_id
        and contacts.org_id = lead_row.org_id;

      if not found or contact_row.deleted_at is not null then
        raise exception 'Lead contact must be an active contact in the same organisation'
          using errcode = '22023';
      end if;

      perform private.set_contact_primary_client(
        lead_row.org_id,
        lead_row.contact_id,
        client_row.id,
        actor_id,
        null
      );
    end if;

    return jsonb_build_object(
      'lead', to_jsonb(lead_row),
      'client', to_jsonb(client_row),
      'idempotent', true
    );
  end if;

  if lead_row.stage = 'lost' then
    raise exception 'Lost leads cannot be converted'
      using errcode = '22023';
  end if;

  contact_email := null;
  contact_phone := null;
  if lead_row.contact_id is not null then
    select * into contact_row
    from public.contacts
    where contacts.id = lead_row.contact_id
      and contacts.org_id = lead_row.org_id;

    if not found or contact_row.deleted_at is not null then
      raise exception 'Lead contact must be an active contact in the same organisation'
        using errcode = '22023';
    end if;

    contact_email := contact_row.primary_email;
    contact_phone := contact_row.primary_phone;
  end if;

  contact_email := coalesce(contact_email, lead_row.primary_email);

  if lead_row.client_id is not null then
    reused_client := true;

    select * into client_row
    from public.clients
    where clients.id = lead_row.client_id
      and clients.org_id = lead_row.org_id
    for update;

    if not found or client_row.deleted_at is not null then
      raise exception 'Lead client must be an active client in the same organisation'
        using errcode = '22023';
    end if;

    if client_row.converted_from_lead_id is null then
      update public.clients
      set
        converted_from_lead_id = lead_row.id,
        updated_by = actor_id
      where clients.id = client_row.id
      returning * into client_row;
    end if;
  else
    client_name := coalesce(
      nullif(trim(p_client_name), ''),
      nullif(trim(lead_row.company_name), ''),
      lead_row.name
    );

    insert into public.clients (
      org_id,
      name,
      status,
      primary_email,
      phone,
      default_currency,
      owner_membership_id,
      converted_from_lead_id,
      notes,
      metadata,
      created_by,
      updated_by
    )
    values (
      lead_row.org_id,
      client_name,
      client_status,
      contact_email,
      contact_phone,
      lead_row.currency,
      lead_row.owner_membership_id,
      lead_row.id,
      lead_row.notes,
      coalesce(lead_row.metadata, '{}'::jsonb),
      actor_id,
      actor_id
    )
    returning * into client_row;
  end if;

  if lead_row.contact_id is not null then
    perform private.set_contact_primary_client(
      lead_row.org_id,
      lead_row.contact_id,
      client_row.id,
      actor_id,
      null
    );
  end if;

  update public.leads
  set
    stage = 'won',
    client_id = client_row.id,
    won_at = now_ts,
    converted_at = now_ts,
    lost_at = null,
    lost_reason = null,
    updated_by = actor_id
  where leads.id = lead_row.id
  returning * into lead_row;

  insert into public.timeline_events (
    org_id,
    entity_type,
    entity_id,
    kind,
    title,
    body,
    actor_type,
    actor_id,
    source_type,
    source_id,
    payload,
    occurred_at
  )
  values
    (
      lead_row.org_id,
      'lead',
      lead_row.id,
      'conversion',
      'Lead converted to client',
      case
        when reused_client then format('Linked existing client "%s"', client_row.name)
        else format('Created client "%s"', client_row.name)
      end,
      'user',
      actor_id,
      'client',
      client_row.id,
      jsonb_build_object(
        'client_id', client_row.id,
        'lead_id', lead_row.id,
        'reused_client', reused_client
      ),
      now_ts
    ),
    (
      lead_row.org_id,
      'client',
      client_row.id,
      'conversion',
      'Client created from conversion',
      'Converted from the sales pipeline',
      'user',
      actor_id,
      null,
      null,
      jsonb_build_object('client_id', client_row.id, 'reused_client', reused_client),
      now_ts
    );

  return jsonb_build_object(
    'lead', to_jsonb(lead_row),
    'client', to_jsonb(client_row),
    'idempotent', false
  );
end;
$$;

-- Prefer contact email, fall back to lead.primary_email.
create or replace function public.resolve_playbook_entity_email(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  email text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if p_entity_type = 'contact' then
    select contacts.primary_email into email
    from public.contacts
    where contacts.id = p_entity_id
      and contacts.org_id = p_org_id
      and contacts.deleted_at is null;
  elsif p_entity_type = 'client' then
    select clients.primary_email into email
    from public.clients
    where clients.id = p_entity_id
      and clients.org_id = p_org_id
      and clients.deleted_at is null;
  elsif p_entity_type = 'lead' then
    select coalesce(contacts.primary_email, leads.primary_email) into email
    from public.leads
    left join public.contacts
      on contacts.id = leads.contact_id
     and contacts.org_id = leads.org_id
     and contacts.deleted_at is null
    where leads.id = p_entity_id
      and leads.org_id = p_org_id
      and leads.deleted_at is null;
  elsif p_entity_type = 'invoice' then
    select coalesce(contacts.primary_email, clients.primary_email) into email
    from public.invoices
    left join public.clients
      on clients.id = invoices.client_id
     and clients.org_id = invoices.org_id
     and clients.deleted_at is null
    left join public.contacts
      on contacts.id = invoices.contact_id
     and contacts.org_id = invoices.org_id
     and contacts.deleted_at is null
    where invoices.id = p_entity_id
      and invoices.org_id = p_org_id
      and invoices.deleted_at is null;
  elsif p_entity_type = 'quote' then
    select coalesce(contacts.primary_email, clients.primary_email) into email
    from public.quotes
    left join public.clients
      on clients.id = quotes.client_id
     and clients.org_id = quotes.org_id
     and clients.deleted_at is null
    left join public.contacts
      on contacts.id = quotes.contact_id
     and contacts.org_id = quotes.org_id
     and contacts.deleted_at is null
    where quotes.id = p_entity_id
      and quotes.org_id = p_org_id
      and quotes.deleted_at is null;
  end if;

  return nullif(btrim(email), '');
end;
$$;

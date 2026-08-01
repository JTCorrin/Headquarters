-- convert_lead: always ensure the lead contact is the client's primary relation.
-- Previously skipped all link work when any active client_contacts row existed,
-- leaving non-primary links unpromoted. Idempotent retries now repair/confirm
-- the intended primary (is_primary + role) as well.

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

  -- Idempotent path: already converted (stage won), not merely pre-linked.
  -- Still repair/confirm the lead contact as the client's primary relation.
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
      perform private.set_contact_primary_client(
        lead_row.org_id,
        lead_row.contact_id,
        client_row.id,
        actor_id
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
      and contacts.org_id = lead_row.org_id
    for update;

    if not found or contact_row.deleted_at is not null then
      raise exception 'Lead contact must be an active contact in the same organisation'
        using errcode = '22023';
    end if;

    contact_email := contact_row.primary_email;
    contact_phone := contact_row.primary_phone;
  end if;

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

  -- Promote existing non-primary link, insert if missing, demote prior primary
  -- with is_primary + role kept consistent (via set_contact_primary_client).
  if lead_row.contact_id is not null then
    perform private.set_contact_primary_client(
      lead_row.org_id,
      lead_row.contact_id,
      client_row.id,
      actor_id
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

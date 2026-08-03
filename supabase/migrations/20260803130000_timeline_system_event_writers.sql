-- Timeline system event writers for quote/invoice lifecycle RPCs.
-- Model: RESEARCH/TIMELINE_SYSTEM_EVENTS_MODEL.md (Buzz nest).

create or replace function private.append_timeline_event(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_actor_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_payload jsonb,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_id uuid;
begin
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
  values (
    p_org_id,
    p_entity_type,
    p_entity_id,
    p_kind,
    p_title,
    p_body,
    'user',
    p_actor_id,
    p_source_type,
    p_source_id,
    coalesce(p_payload, '{}'::jsonb),
    coalesce(p_occurred_at, now())
  )
  returning id into created_id;

  return created_id;
end;
$$;

revoke all on function private.append_timeline_event(
  uuid, text, uuid, text, text, text, uuid, text, uuid, jsonb, timestamptz
) from public, anon, authenticated;


create or replace function public.create_quote_draft(
  p_org_id uuid,
  p_payload jsonb,
  p_lines jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  quote_row public.quotes;
  org_currency char(3);
  title text;
  currency text;
  issue_on date;
  valid_until date;
  v_discount_cents bigint;
  client_id uuid;
  lead_id uuid;
  contact_id uuid;
  owner_membership_id uuid;
  terms text;
  notes text;
  internal_notes text;
  allocated_number text;
  lines_json jsonb;
  line_totals record;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Quote payload must be an object'
      using errcode = '22023';
  end if;

  select organisations.default_currency into org_currency
  from public.organisations
  where organisations.id = p_org_id
    and organisations.deleted_at is null;

  if not found then
    raise exception 'Organisation not found'
      using errcode = 'P0002';
  end if;

  title := nullif(trim(coalesce(p_payload ->> 'title', '')), '');
  if title is null or char_length(title) > 160 then
    raise exception 'Quote title must be between 1 and 160 characters'
      using errcode = '22023';
  end if;

  currency := upper(coalesce(nullif(trim(p_payload ->> 'currency'), ''), org_currency));
  if currency !~ '^[A-Z]{3}$' then
    raise exception 'Quote currency must be a 3-letter ISO code'
      using errcode = '22023';
  end if;

  issue_on := coalesce((p_payload ->> 'issue_on')::date, (timezone('utc', now()))::date);
  valid_until := nullif(p_payload ->> 'valid_until', '')::date;
  v_discount_cents := coalesce((p_payload ->> 'discount_cents')::bigint, 0);
  client_id := nullif(p_payload ->> 'client_id', '')::uuid;
  lead_id := nullif(p_payload ->> 'lead_id', '')::uuid;
  contact_id := nullif(p_payload ->> 'contact_id', '')::uuid;
  owner_membership_id := nullif(p_payload ->> 'owner_membership_id', '')::uuid;
  terms := nullif(trim(coalesce(p_payload ->> 'terms', '')), '');
  notes := nullif(trim(coalesce(p_payload ->> 'notes', '')), '');
  internal_notes := nullif(trim(coalesce(p_payload ->> 'internal_notes', '')), '');

  if client_id is null and lead_id is null then
    raise exception 'Quote requires client_id or lead_id'
      using errcode = '22023';
  end if;

  if v_discount_cents < 0 then
    raise exception 'Quote discount_cents must be non-negative'
      using errcode = '22023';
  end if;

  allocated_number := private.allocate_document_number(p_org_id, 'quote');

  perform set_config('app.allow_quote_totals', 'on', true);

  insert into public.quotes (
    org_id,
    number,
    title,
    client_id,
    lead_id,
    contact_id,
    owner_membership_id,
    status,
    currency,
    issue_on,
    valid_until,
    subtotal_cents,
    discount_cents,
    tax_cents,
    total_cents,
    party_snapshot,
    terms,
    notes,
    internal_notes,
    created_by,
    updated_by
  )
  values (
    p_org_id,
    allocated_number,
    title,
    client_id,
    lead_id,
    contact_id,
    owner_membership_id,
    'draft',
    currency,
    issue_on,
    valid_until,
    0,
    0,
    0,
    0,
    '{}'::jsonb,
    terms,
    notes,
    internal_notes,
    actor_id,
    actor_id
  )
  returning * into quote_row;

  select * into line_totals
  from private.replace_quote_lines(
    p_org_id,
    quote_row.id,
    actor_id,
    coalesce(p_lines, '[]'::jsonb),
    currency::char(3)
  );

  if v_discount_cents > line_totals.subtotal_cents then
    raise exception 'Quote discount_cents cannot exceed subtotal_cents'
      using errcode = '23514';
  end if;

  perform private.assert_json_safe_cents(
    line_totals.subtotal_cents - v_discount_cents + line_totals.tax_cents,
    'Quote total_cents'
  );

  update public.quotes
  set
    discount_cents = v_discount_cents,
    subtotal_cents = line_totals.subtotal_cents,
    tax_cents = line_totals.tax_cents,
    total_cents = line_totals.subtotal_cents - v_discount_cents + line_totals.tax_cents,
    updated_by = actor_id
  where quotes.id = quote_row.id
  returning * into quote_row;

  select coalesce(
    jsonb_agg(to_jsonb(quote_lines) order by quote_lines.position, quote_lines.id),
    '[]'::jsonb
  )
  into lines_json
  from public.quote_lines
  where quote_lines.quote_id = quote_row.id;

  perform set_config('app.allow_quote_totals', 'off', true);


  -- Timeline: quote created (primary + client/lead fan-out)
  perform private.append_timeline_event(
    quote_row.org_id,
    'quote',
    quote_row.id,
    'status',
    'Quote created',
    null,
    actor_id,
    'quote',
    quote_row.id,
    jsonb_build_object(
      'action', 'quote.created',
      'quote_id', quote_row.id,
      'number', quote_row.number,
      'client_id', quote_row.client_id,
      'lead_id', quote_row.lead_id
    )
  );

  if quote_row.client_id is not null then
    perform private.append_timeline_event(
      quote_row.org_id,
      'client',
      quote_row.client_id,
      'status',
      'Quote created',
      format('Quote %s', quote_row.number),
      actor_id,
      'quote',
      quote_row.id,
      jsonb_build_object(
        'action', 'quote.created',
        'quote_id', quote_row.id,
        'number', quote_row.number,
        'client_id', quote_row.client_id,
        'lead_id', quote_row.lead_id
      )
    );
  end if;

  if quote_row.lead_id is not null then
    perform private.append_timeline_event(
      quote_row.org_id,
      'lead',
      quote_row.lead_id,
      'status',
      'Quote created',
      format('Quote %s', quote_row.number),
      actor_id,
      'quote',
      quote_row.id,
      jsonb_build_object(
        'action', 'quote.created',
        'quote_id', quote_row.id,
        'number', quote_row.number,
        'client_id', quote_row.client_id,
        'lead_id', quote_row.lead_id
      )
    );
  end if;

  return jsonb_build_object(
    'quote', to_jsonb(quote_row),
    'lines', lines_json
  );
end;
$$;

create or replace function public.accept_quote(
  p_quote_id uuid,
  p_org_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  quote_row public.quotes;
  client_row public.clients;
  contact_row public.contacts;
  snapshot jsonb;
  lines_json jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into quote_row
  from public.quotes
  where quotes.id = p_quote_id
    and quotes.org_id = p_org_id
    and quotes.deleted_at is null
  for update;

  if not found then
    raise exception 'Quote not found'
      using errcode = 'P0002';
  end if;

  if quote_row.version is distinct from p_expected_version then
    raise exception 'Quote version conflict'
      using errcode = 'P0001';
  end if;

  if quote_row.status not in ('draft', 'sent') then
    raise exception 'Only draft or sent quotes can be accepted'
      using errcode = '22023';
  end if;

  if quote_row.client_id is null then
    raise exception 'Only quotes with a client can be accepted for invoicing'
      using errcode = '22023';
  end if;

  select * into client_row
  from public.clients
  where clients.id = quote_row.client_id
    and clients.org_id = p_org_id;

  if not found then
    raise exception 'Quote client not found'
      using errcode = 'P0002';
  end if;

  if quote_row.contact_id is not null then
    select * into contact_row
    from public.contacts
    where contacts.id = quote_row.contact_id
      and contacts.org_id = p_org_id;
  end if;

  snapshot := jsonb_build_object(
    'client', jsonb_build_object(
      'id', client_row.id,
      'name', client_row.name,
      'primary_email', client_row.primary_email,
      'phone', client_row.phone,
      'tax_identifier', client_row.tax_identifier,
      'registration_number', client_row.registration_number
    ),
    'contact', case
      when contact_row.id is not null then jsonb_build_object(
        'id', contact_row.id,
        'display_name', contact_row.display_name,
        'primary_email', contact_row.primary_email,
        'primary_phone', contact_row.primary_phone
      )
      else null
    end
  );

  perform set_config('app.allow_quote_lifecycle', 'on', true);
  perform set_config('app.allow_quote_totals', 'on', true);

  update public.quotes
  set
    status = 'accepted',
    party_snapshot = snapshot,
    accepted_at = now(),
    updated_by = actor_id
  where quotes.id = quote_row.id
  returning * into quote_row;

  perform set_config('app.allow_quote_lifecycle', 'off', true);
  perform set_config('app.allow_quote_totals', 'off', true);

  select coalesce(
    jsonb_agg(to_jsonb(quote_lines) order by quote_lines.position, quote_lines.id),
    '[]'::jsonb
  )
  into lines_json
  from public.quote_lines
  where quote_lines.quote_id = quote_row.id;


  -- Timeline: quote accepted (primary + client fan-out)
  perform private.append_timeline_event(
    quote_row.org_id,
    'quote',
    quote_row.id,
    'status',
    'Quote accepted',
    null,
    actor_id,
    'quote',
    quote_row.id,
    jsonb_build_object(
      'action', 'quote.accepted',
      'quote_id', quote_row.id,
      'number', quote_row.number,
      'client_id', quote_row.client_id
    )
  );

  if quote_row.client_id is not null then
    perform private.append_timeline_event(
      quote_row.org_id,
      'client',
      quote_row.client_id,
      'status',
      'Quote accepted',
      format('Quote %s', quote_row.number),
      actor_id,
      'quote',
      quote_row.id,
      jsonb_build_object(
        'action', 'quote.accepted',
        'quote_id', quote_row.id,
        'number', quote_row.number,
        'client_id', quote_row.client_id
      )
    );
  end if;

  return jsonb_build_object(
    'quote', to_jsonb(quote_row),
    'lines', lines_json
  );
end;
$$;

create or replace function public.create_invoice_draft(
  p_org_id uuid,
  p_payload jsonb,
  p_lines jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  invoice_row public.invoices;
  org_currency char(3);
  currency text;
  issue_on date;
  due_on date;
  v_discount_cents bigint;
  client_id uuid;
  contact_id uuid;
  owner_membership_id uuid;
  purchase_order_number text;
  payment_terms text;
  notes text;
  internal_notes text;
  allocated_number text;
  lines_json jsonb;
  line_totals record;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invoice payload must be an object'
      using errcode = '22023';
  end if;

  select organisations.default_currency into org_currency
  from public.organisations
  where organisations.id = p_org_id
    and organisations.deleted_at is null;

  if not found then
    raise exception 'Organisation not found'
      using errcode = 'P0002';
  end if;

  client_id := nullif(p_payload ->> 'client_id', '')::uuid;
  if client_id is null then
    raise exception 'Invoice requires client_id'
      using errcode = '22023';
  end if;

  contact_id := nullif(p_payload ->> 'contact_id', '')::uuid;
  owner_membership_id := nullif(p_payload ->> 'owner_membership_id', '')::uuid;

  currency := upper(coalesce(nullif(trim(p_payload ->> 'currency'), ''), org_currency));
  if currency !~ '^[A-Z]{3}$' then
    raise exception 'Invoice currency must be a 3-letter ISO code'
      using errcode = '22023';
  end if;

  issue_on := coalesce((p_payload ->> 'issue_on')::date, (timezone('utc', now()))::date);
  due_on := coalesce((p_payload ->> 'due_on')::date, issue_on + 30);

  if due_on < issue_on then
    raise exception 'Invoice due_on cannot be before issue_on'
      using errcode = '22023';
  end if;

  v_discount_cents := coalesce((p_payload ->> 'discount_cents')::bigint, 0);
  if v_discount_cents < 0 then
    raise exception 'Invoice discount_cents must be non-negative'
      using errcode = '22023';
  end if;

  purchase_order_number := nullif(trim(coalesce(p_payload ->> 'purchase_order_number', '')), '');
  payment_terms := nullif(trim(coalesce(p_payload ->> 'payment_terms', '')), '');
  notes := nullif(trim(coalesce(p_payload ->> 'notes', '')), '');
  internal_notes := nullif(trim(coalesce(p_payload ->> 'internal_notes', '')), '');

  allocated_number := private.allocate_document_number(p_org_id, 'invoice');

  perform set_config('app.allow_invoice_totals', 'on', true);

  insert into public.invoices (
    org_id,
    number,
    client_id,
    contact_id,
    owner_membership_id,
    source,
    status,
    currency,
    issue_on,
    due_on,
    purchase_order_number,
    subtotal_cents,
    discount_cents,
    tax_cents,
    total_cents,
    paid_cents,
    balance_due_cents,
    party_snapshot,
    payment_terms,
    notes,
    internal_notes,
    created_by,
    updated_by
  )
  values (
    p_org_id,
    allocated_number,
    client_id,
    contact_id,
    owner_membership_id,
    'manual',
    'draft',
    currency,
    issue_on,
    due_on,
    purchase_order_number,
    0,
    0,
    0,
    0,
    0,
    0,
    '{}'::jsonb,
    payment_terms,
    notes,
    internal_notes,
    actor_id,
    actor_id
  )
  returning * into invoice_row;

  select * into line_totals
  from private.replace_invoice_lines(
    p_org_id,
    invoice_row.id,
    actor_id,
    coalesce(p_lines, '[]'::jsonb),
    currency::char(3)
  );

  if v_discount_cents > line_totals.subtotal_cents then
    raise exception 'Invoice discount_cents cannot exceed subtotal_cents'
      using errcode = '23514';
  end if;

  perform private.assert_json_safe_cents(
    line_totals.subtotal_cents - v_discount_cents + line_totals.tax_cents,
    'Invoice total_cents'
  );

  update public.invoices
  set
    discount_cents = v_discount_cents,
    subtotal_cents = line_totals.subtotal_cents,
    tax_cents = line_totals.tax_cents,
    total_cents = line_totals.subtotal_cents - v_discount_cents + line_totals.tax_cents,
    balance_due_cents = line_totals.subtotal_cents - v_discount_cents + line_totals.tax_cents,
    updated_by = actor_id
  where invoices.id = invoice_row.id
  returning * into invoice_row;

  select coalesce(
    jsonb_agg(to_jsonb(invoice_lines) order by invoice_lines.position, invoice_lines.id),
    '[]'::jsonb
  )
  into lines_json
  from public.invoice_lines
  where invoice_lines.invoice_id = invoice_row.id;

  perform set_config('app.allow_invoice_totals', 'off', true);


  -- Timeline: invoice created (primary + client fan-out)
  perform private.append_timeline_event(
    invoice_row.org_id,
    'invoice',
    invoice_row.id,
    'status',
    'Invoice created',
    null,
    actor_id,
    'invoice',
    invoice_row.id,
    jsonb_build_object(
      'action', 'invoice.created',
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
    'Invoice created',
    format('Invoice %s', invoice_row.number),
    actor_id,
    'invoice',
    invoice_row.id,
    jsonb_build_object(
      'action', 'invoice.created',
      'invoice_id', invoice_row.id,
      'number', invoice_row.number,
      'client_id', invoice_row.client_id
    )
  );

  return jsonb_build_object(
    'invoice', to_jsonb(invoice_row),
    'lines', lines_json
  );
end;
$$;

create or replace function public.send_invoice(
  p_invoice_id uuid,
  p_org_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  invoice_row public.invoices;
  client_row public.clients;
  contact_row public.contacts;
  snapshot jsonb;
  lines_json jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

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

  -- Quote-derived invoices keep the accepted (or draft-updated) party snapshot.
  -- Manual drafts still freeze live client/contact data at send time.
  if invoice_row.source = 'quote'
    and invoice_row.party_snapshot ? 'client'
  then
    snapshot := invoice_row.party_snapshot;
  else
    select * into client_row
    from public.clients
    where clients.id = invoice_row.client_id
      and clients.org_id = p_org_id;

    if not found then
      raise exception 'Invoice client not found'
        using errcode = 'P0002';
    end if;

    if invoice_row.contact_id is not null then
      select * into contact_row
      from public.contacts
      where contacts.id = invoice_row.contact_id
        and contacts.org_id = p_org_id;
    end if;

    snapshot := jsonb_build_object(
      'client', jsonb_build_object(
        'id', client_row.id,
        'name', client_row.name,
        'primary_email', client_row.primary_email,
        'phone', client_row.phone,
        'tax_identifier', client_row.tax_identifier,
        'registration_number', client_row.registration_number
      ),
      'contact', case
        when contact_row.id is not null then jsonb_build_object(
          'id', contact_row.id,
          'display_name', contact_row.display_name,
          'primary_email', contact_row.primary_email,
          'primary_phone', contact_row.primary_phone
        )
        else null
      end
    );
  end if;

  perform set_config('app.allow_invoice_lifecycle', 'on', true);

  update public.invoices
  set
    status = 'sent',
    party_snapshot = snapshot,
    balance_due_cents = invoices.total_cents - invoices.paid_cents,
    sent_at = now(),
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


  -- Timeline: invoice sent (primary + client fan-out)
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
    'lines', lines_json
  );
end;
$$;

create or replace function public.void_invoice(
  p_invoice_id uuid,
  p_org_id uuid,
  p_expected_version integer,
  p_void_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  invoice_row public.invoices;
  reason text;
  lines_json jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  reason := nullif(trim(coalesce(p_void_reason, '')), '');
  if reason is null then
    raise exception 'void_reason is required'
      using errcode = '22023';
  end if;

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

  if invoice_row.status not in ('draft', 'sent') then
    raise exception 'Only draft or sent invoices can be voided'
      using errcode = '22023';
  end if;

  perform set_config('app.allow_invoice_lifecycle', 'on', true);

  update public.invoices
  set
    status = 'void',
    -- A voided receivable is no longer collectible.
    balance_due_cents = 0,
    voided_at = now(),
    void_reason = reason,
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


  -- Timeline: invoice voided (primary + client fan-out)
  perform private.append_timeline_event(
    invoice_row.org_id,
    'invoice',
    invoice_row.id,
    'status',
    'Invoice voided',
    reason,
    actor_id,
    'invoice',
    invoice_row.id,
    jsonb_build_object(
      'action', 'invoice.voided',
      'invoice_id', invoice_row.id,
      'number', invoice_row.number,
      'client_id', invoice_row.client_id,
      'void_reason', reason
    )
  );

  perform private.append_timeline_event(
    invoice_row.org_id,
    'client',
    invoice_row.client_id,
    'status',
    'Invoice voided',
    format('Invoice %s — %s', invoice_row.number, reason),
    actor_id,
    'invoice',
    invoice_row.id,
    jsonb_build_object(
      'action', 'invoice.voided',
      'invoice_id', invoice_row.id,
      'number', invoice_row.number,
      'client_id', invoice_row.client_id,
      'void_reason', reason
    )
  );

  return jsonb_build_object(
    'invoice', to_jsonb(invoice_row),
    'lines', lines_json
  );
end;
$$;

create or replace function public.create_invoice_from_quote(
  p_quote_id uuid,
  p_org_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  quote_row public.quotes;
  invoice_row public.invoices;
  allocated_number text;
  lines_json jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into quote_row
  from public.quotes
  where quotes.id = p_quote_id
    and quotes.org_id = p_org_id
    and quotes.deleted_at is null
  for update;

  if not found then
    raise exception 'Quote not found'
      using errcode = 'P0002';
  end if;

  -- Idempotent reconvert: return the previously converted *live* invoice.
  -- Soft-deleted conversion targets are ignored and the link is cleared so a
  -- fresh draft can be created (soft_delete_invoice_draft also clears the link).
  if quote_row.converted_invoice_id is not null then
    select * into invoice_row
    from public.invoices
    where invoices.id = quote_row.converted_invoice_id
      and invoices.org_id = p_org_id
      and invoices.deleted_at is null;

    if found then
      select coalesce(
        jsonb_agg(to_jsonb(invoice_lines) order by invoice_lines.position, invoice_lines.id),
        '[]'::jsonb
      )
      into lines_json
      from public.invoice_lines
      where invoice_lines.invoice_id = invoice_row.id;

      return jsonb_build_object(
        'invoice', to_jsonb(invoice_row),
        'lines', lines_json,
        'created', false
      );
    end if;

    perform set_config('app.allow_quote_lifecycle', 'on', true);
    perform set_config('app.allow_quote_totals', 'on', true);

    update public.quotes
    set
      converted_invoice_id = null,
      updated_by = actor_id
    where quotes.id = quote_row.id;

    quote_row.converted_invoice_id := null;

    perform set_config('app.allow_quote_lifecycle', 'off', true);
    perform set_config('app.allow_quote_totals', 'off', true);
  end if;

  if quote_row.status <> 'accepted' then
    raise exception 'Only accepted quotes can be converted to an invoice'
      using errcode = '22023';
  end if;

  if quote_row.client_id is null then
    raise exception 'Only quotes with a client can be converted to an invoice'
      using errcode = '22023';
  end if;

  allocated_number := private.allocate_document_number(p_org_id, 'invoice');

  perform set_config('app.allow_invoice_totals', 'on', true);

  insert into public.invoices (
    org_id,
    number,
    client_id,
    contact_id,
    quote_id,
    owner_membership_id,
    source,
    status,
    currency,
    issue_on,
    due_on,
    subtotal_cents,
    discount_cents,
    tax_cents,
    total_cents,
    paid_cents,
    balance_due_cents,
    party_snapshot,
    notes,
    created_by,
    updated_by
  )
  values (
    p_org_id,
    allocated_number,
    quote_row.client_id,
    quote_row.contact_id,
    quote_row.id,
    quote_row.owner_membership_id,
    'quote',
    'draft',
    quote_row.currency,
    (timezone('utc', now()))::date,
    (timezone('utc', now()))::date + 30,
    quote_row.subtotal_cents,
    quote_row.discount_cents,
    quote_row.tax_cents,
    quote_row.total_cents,
    0,
    quote_row.total_cents,
    quote_row.party_snapshot,
    quote_row.notes,
    actor_id,
    actor_id
  )
  returning * into invoice_row;

  -- Copy immutable line snapshots without recalculating or mutating the quote.
  insert into public.invoice_lines (
    org_id,
    invoice_id,
    product_id,
    sku_snapshot,
    description,
    quantity,
    unit_price_cents,
    discount_percent,
    tax_rate_percent,
    subtotal_cents,
    tax_cents,
    total_cents,
    position,
    created_by,
    updated_by
  )
  select
    quote_lines.org_id,
    invoice_row.id,
    quote_lines.product_id,
    quote_lines.sku_snapshot,
    quote_lines.description,
    quote_lines.quantity,
    quote_lines.unit_price_cents,
    quote_lines.discount_percent,
    quote_lines.tax_rate_percent,
    quote_lines.subtotal_cents,
    quote_lines.tax_cents,
    quote_lines.total_cents,
    quote_lines.position,
    actor_id,
    actor_id
  from public.quote_lines
  where quote_lines.quote_id = quote_row.id
    and quote_lines.org_id = p_org_id;

  perform set_config('app.allow_invoice_totals', 'off', true);

  -- converted_invoice_id is protected by allow_quote_totals, and editing a
  -- non-draft (accepted) quote at all requires allow_quote_lifecycle.
  perform set_config('app.allow_quote_lifecycle', 'on', true);
  perform set_config('app.allow_quote_totals', 'on', true);

  update public.quotes
  set
    converted_invoice_id = invoice_row.id,
    updated_by = actor_id
  where quotes.id = quote_row.id;

  perform set_config('app.allow_quote_lifecycle', 'off', true);
  perform set_config('app.allow_quote_totals', 'off', true);

  select coalesce(
    jsonb_agg(to_jsonb(invoice_lines) order by invoice_lines.position, invoice_lines.id),
    '[]'::jsonb
  )
  into lines_json
  from public.invoice_lines
  where invoice_lines.invoice_id = invoice_row.id;


  -- Timeline: quote → invoice conversion (quote + invoice primaries + client fan-out)
  -- Only on fresh create (idempotent reconvert returns earlier).
  perform private.append_timeline_event(
    quote_row.org_id,
    'quote',
    quote_row.id,
    'conversion',
    'Quote converted to invoice',
    format('Created invoice %s', invoice_row.number),
    actor_id,
    'invoice',
    invoice_row.id,
    jsonb_build_object(
      'action', 'quote.converted_to_invoice',
      'quote_id', quote_row.id,
      'invoice_id', invoice_row.id,
      'quote_number', quote_row.number,
      'invoice_number', invoice_row.number,
      'client_id', quote_row.client_id
    )
  );

  perform private.append_timeline_event(
    invoice_row.org_id,
    'invoice',
    invoice_row.id,
    'conversion',
    'Invoice created from quote',
    format('Converted from quote %s', quote_row.number),
    actor_id,
    'quote',
    quote_row.id,
    jsonb_build_object(
      'action', 'quote.converted_to_invoice',
      'quote_id', quote_row.id,
      'invoice_id', invoice_row.id,
      'quote_number', quote_row.number,
      'invoice_number', invoice_row.number,
      'client_id', invoice_row.client_id
    )
  );

  if quote_row.client_id is not null then
    perform private.append_timeline_event(
      quote_row.org_id,
      'client',
      quote_row.client_id,
      'conversion',
      'Quote converted to invoice',
      format('%s → %s', quote_row.number, invoice_row.number),
      actor_id,
      'quote',
      quote_row.id,
      jsonb_build_object(
        'action', 'quote.converted_to_invoice',
        'quote_id', quote_row.id,
        'invoice_id', invoice_row.id,
        'quote_number', quote_row.number,
        'invoice_number', invoice_row.number,
        'client_id', quote_row.client_id
      )
    );
  end if;

  return jsonb_build_object(
    'invoice', to_jsonb(invoice_row),
    'lines', lines_json,
    'created', true
  );
end;
$$;


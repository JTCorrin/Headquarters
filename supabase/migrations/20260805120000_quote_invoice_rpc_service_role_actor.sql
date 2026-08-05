-- MCP Wave C: quote/invoice draft RPCs under API-key / service_role.
-- Same pattern as contact/project hotfixes: GRANT EXECUTE + p_actor_id when auth.uid() is null.

drop function if exists public.create_quote_draft(uuid, jsonb, jsonb);
drop function if exists public.save_quote_draft(uuid, uuid, integer, jsonb, jsonb);
drop function if exists public.get_quote_document(uuid, uuid);
drop function if exists public.create_invoice_draft(uuid, jsonb, jsonb);
drop function if exists public.save_invoice_draft(uuid, uuid, integer, jsonb, jsonb);
drop function if exists public.get_invoice_document(uuid, uuid);

create or replace function public.create_quote_draft(
  p_org_id uuid,
  p_payload jsonb,
  p_lines jsonb default '[]'::jsonb,
  p_actor_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  jwt_uid uuid := auth.uid();
  actor_id uuid;
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
  if jwt_uid is not null then
    actor_id := jwt_uid;
    if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
  elsif auth.role() = 'service_role' then
    if p_actor_id is null then
      raise exception 'Authentication is required'
        using errcode = '42501';
    end if;
    if not exists (
      select 1
      from public.memberships
      join public.organisations
        on organisations.id = memberships.org_id
      where memberships.org_id = p_org_id
        and memberships.user_id = p_actor_id
        and memberships.status = 'active'
        and organisations.deleted_at is null
        and memberships.role = any (array['owner', 'admin', 'member'])
    ) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
    actor_id := p_actor_id;
  else
    raise exception 'Authentication is required'
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

create or replace function public.save_quote_draft(
  p_quote_id uuid,
  p_org_id uuid,
  p_expected_version integer,
  p_payload jsonb,
  p_lines jsonb default null,
  p_actor_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  jwt_uid uuid := auth.uid();
  actor_id uuid;
  quote_row public.quotes;
  lines_json jsonb;
  next_title text;
  next_client_id uuid;
  next_lead_id uuid;
  next_contact_id uuid;
  next_owner_membership_id uuid;
  next_currency char(3);
  next_issue_on date;
  next_valid_until date;
  next_discount_cents bigint;
  next_terms text;
  next_notes text;
  next_internal_notes text;
  line_totals record;
  next_subtotal bigint;
  next_tax bigint;
begin
  if jwt_uid is not null then
    actor_id := jwt_uid;
    if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
  elsif auth.role() = 'service_role' then
    if p_actor_id is null then
      raise exception 'Authentication is required'
        using errcode = '42501';
    end if;
    if not exists (
      select 1
      from public.memberships
      join public.organisations
        on organisations.id = memberships.org_id
      where memberships.org_id = p_org_id
        and memberships.user_id = p_actor_id
        and memberships.status = 'active'
        and organisations.deleted_at is null
        and memberships.role = any (array['owner', 'admin', 'member'])
    ) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
    actor_id := p_actor_id;
  else
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Quote payload must be an object'
      using errcode = '22023';
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

  if quote_row.status <> 'draft' then
    raise exception 'Only draft quotes can be edited in this release'
      using errcode = '22023';
  end if;

  next_title := case
    when p_payload ? 'title' then nullif(trim(p_payload ->> 'title'), '')
    else quote_row.title
  end;
  next_client_id := case
    when p_payload ? 'client_id' then nullif(p_payload ->> 'client_id', '')::uuid
    else quote_row.client_id
  end;
  next_lead_id := case
    when p_payload ? 'lead_id' then nullif(p_payload ->> 'lead_id', '')::uuid
    else quote_row.lead_id
  end;
  next_contact_id := case
    when p_payload ? 'contact_id' then nullif(p_payload ->> 'contact_id', '')::uuid
    else quote_row.contact_id
  end;
  next_owner_membership_id := case
    when p_payload ? 'owner_membership_id'
      then nullif(p_payload ->> 'owner_membership_id', '')::uuid
    else quote_row.owner_membership_id
  end;
  next_currency := case
    when p_payload ? 'currency' then upper(trim(p_payload ->> 'currency'))
    else quote_row.currency
  end;
  next_issue_on := case
    when p_payload ? 'issue_on' then (p_payload ->> 'issue_on')::date
    else quote_row.issue_on
  end;
  next_valid_until := case
    when p_payload ? 'valid_until' then nullif(p_payload ->> 'valid_until', '')::date
    else quote_row.valid_until
  end;
  next_discount_cents := case
    when p_payload ? 'discount_cents' then (p_payload ->> 'discount_cents')::bigint
    else quote_row.discount_cents
  end;
  next_terms := case
    when p_payload ? 'terms' then nullif(trim(coalesce(p_payload ->> 'terms', '')), '')
    else quote_row.terms
  end;
  next_notes := case
    when p_payload ? 'notes' then nullif(trim(coalesce(p_payload ->> 'notes', '')), '')
    else quote_row.notes
  end;
  next_internal_notes := case
    when p_payload ? 'internal_notes'
      then nullif(trim(coalesce(p_payload ->> 'internal_notes', '')), '')
    else quote_row.internal_notes
  end;

  if next_title is null or char_length(next_title) > 160 then
    raise exception 'Quote title must be between 1 and 160 characters'
      using errcode = '22023';
  end if;

  if next_currency !~ '^[A-Z]{3}$' then
    raise exception 'Quote currency must be a 3-letter ISO code'
      using errcode = '22023';
  end if;

  if next_client_id is null and next_lead_id is null then
    raise exception 'Quote requires client_id or lead_id'
      using errcode = '22023';
  end if;

  if next_discount_cents < 0 then
    raise exception 'Quote discount_cents must be non-negative'
      using errcode = '22023';
  end if;

  if next_currency is distinct from quote_row.currency and p_lines is null then
    raise exception 'Changing quote currency requires replacing lines'
      using errcode = '22023';
  end if;

  perform set_config('app.allow_quote_totals', 'on', true);

  if p_lines is not null then
    select * into line_totals
    from private.replace_quote_lines(
      p_org_id,
      quote_row.id,
      actor_id,
      p_lines,
      next_currency
    );
    next_subtotal := line_totals.subtotal_cents;
    next_tax := line_totals.tax_cents;
  else
    select
      coalesce(sum(quote_lines.subtotal_cents), 0),
      coalesce(sum(quote_lines.tax_cents), 0)
    into next_subtotal, next_tax
    from public.quote_lines
    where quote_lines.quote_id = quote_row.id;
  end if;

  if next_discount_cents > next_subtotal then
    raise exception 'Quote discount_cents cannot exceed subtotal_cents'
      using errcode = '23514';
  end if;

  perform private.assert_json_safe_cents(
    next_subtotal - next_discount_cents + next_tax,
    'Quote total_cents'
  );

  update public.quotes
  set
    title = next_title,
    client_id = next_client_id,
    lead_id = next_lead_id,
    contact_id = next_contact_id,
    owner_membership_id = next_owner_membership_id,
    currency = next_currency,
    issue_on = next_issue_on,
    valid_until = next_valid_until,
    discount_cents = next_discount_cents,
    subtotal_cents = next_subtotal,
    tax_cents = next_tax,
    total_cents = next_subtotal - next_discount_cents + next_tax,
    terms = next_terms,
    notes = next_notes,
    internal_notes = next_internal_notes,
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

  return jsonb_build_object(
    'quote', to_jsonb(quote_row),
    'lines', lines_json
  );
end;
$$;

create or replace function public.get_quote_document(
  p_quote_id uuid,
  p_org_id uuid,
  p_actor_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  jwt_uid uuid := auth.uid();
  actor_id uuid;
  quote_row public.quotes;
  lines_json jsonb;
begin
  if jwt_uid is not null then
    actor_id := jwt_uid;
    if not private.has_org_role(p_org_id, array['owner', 'admin', 'member', 'readonly']) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
  elsif auth.role() = 'service_role' then
    if p_actor_id is null then
      raise exception 'Authentication is required'
        using errcode = '42501';
    end if;
    if not exists (
      select 1
      from public.memberships
      join public.organisations
        on organisations.id = memberships.org_id
      where memberships.org_id = p_org_id
        and memberships.user_id = p_actor_id
        and memberships.status = 'active'
        and organisations.deleted_at is null
        and memberships.role = any (array['owner', 'admin', 'member', 'readonly'])
    ) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
    actor_id := p_actor_id;
  else
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  -- Lock the header for the duration of this transaction so a concurrent save
  -- cannot replace lines between header and line reads.
  select * into quote_row
  from public.quotes
  where quotes.id = p_quote_id
    and quotes.org_id = p_org_id
    and quotes.deleted_at is null
  for share;

  if not found then
    raise exception 'Quote not found'
      using errcode = 'P0002';
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(quote_lines) order by quote_lines.position, quote_lines.id),
    '[]'::jsonb
  )
  into lines_json
  from public.quote_lines
  where quote_lines.quote_id = quote_row.id
    and quote_lines.org_id = quote_row.org_id;

  return jsonb_build_object(
    'quote', to_jsonb(quote_row),
    'lines', lines_json
  );
end;
$$;

create or replace function public.create_invoice_draft(
  p_org_id uuid,
  p_payload jsonb,
  p_lines jsonb default '[]'::jsonb,
  p_actor_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  jwt_uid uuid := auth.uid();
  actor_id uuid;
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
  if jwt_uid is not null then
    actor_id := jwt_uid;
    if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
  elsif auth.role() = 'service_role' then
    if p_actor_id is null then
      raise exception 'Authentication is required'
        using errcode = '42501';
    end if;
    if not exists (
      select 1
      from public.memberships
      join public.organisations
        on organisations.id = memberships.org_id
      where memberships.org_id = p_org_id
        and memberships.user_id = p_actor_id
        and memberships.status = 'active'
        and organisations.deleted_at is null
        and memberships.role = any (array['owner', 'admin', 'member'])
    ) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
    actor_id := p_actor_id;
  else
    raise exception 'Authentication is required'
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

create or replace function public.save_invoice_draft(
  p_invoice_id uuid,
  p_org_id uuid,
  p_expected_version integer,
  p_payload jsonb,
  p_lines jsonb default null,
  p_actor_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  jwt_uid uuid := auth.uid();
  actor_id uuid;
  invoice_row public.invoices;
  client_row public.clients;
  contact_row public.contacts;
  lines_json jsonb;
  next_client_id uuid;
  next_contact_id uuid;
  next_owner_membership_id uuid;
  next_currency char(3);
  next_issue_on date;
  next_due_on date;
  next_discount_cents bigint;
  next_purchase_order_number text;
  next_payment_terms text;
  next_notes text;
  next_internal_notes text;
  next_party_snapshot jsonb;
  line_totals record;
  next_subtotal bigint;
  next_tax bigint;
begin
  if jwt_uid is not null then
    actor_id := jwt_uid;
    if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
  elsif auth.role() = 'service_role' then
    if p_actor_id is null then
      raise exception 'Authentication is required'
        using errcode = '42501';
    end if;
    if not exists (
      select 1
      from public.memberships
      join public.organisations
        on organisations.id = memberships.org_id
      where memberships.org_id = p_org_id
        and memberships.user_id = p_actor_id
        and memberships.status = 'active'
        and organisations.deleted_at is null
        and memberships.role = any (array['owner', 'admin', 'member'])
    ) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
    actor_id := p_actor_id;
  else
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invoice payload must be an object'
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

  if invoice_row.status <> 'draft' then
    raise exception 'Only draft invoices can be edited in this release'
      using errcode = '22023';
  end if;

  next_client_id := case
    when p_payload ? 'client_id' then nullif(p_payload ->> 'client_id', '')::uuid
    else invoice_row.client_id
  end;
  if next_client_id is null then
    raise exception 'Invoice requires client_id'
      using errcode = '22023';
  end if;

  next_contact_id := case
    when p_payload ? 'contact_id' then nullif(p_payload ->> 'contact_id', '')::uuid
    else invoice_row.contact_id
  end;
  next_owner_membership_id := case
    when p_payload ? 'owner_membership_id'
      then nullif(p_payload ->> 'owner_membership_id', '')::uuid
    else invoice_row.owner_membership_id
  end;
  next_currency := case
    when p_payload ? 'currency' then upper(trim(p_payload ->> 'currency'))
    else invoice_row.currency
  end;
  next_issue_on := case
    when p_payload ? 'issue_on' then (p_payload ->> 'issue_on')::date
    else invoice_row.issue_on
  end;
  next_due_on := case
    when p_payload ? 'due_on' then (p_payload ->> 'due_on')::date
    else invoice_row.due_on
  end;
  next_discount_cents := case
    when p_payload ? 'discount_cents' then (p_payload ->> 'discount_cents')::bigint
    else invoice_row.discount_cents
  end;
  next_purchase_order_number := case
    when p_payload ? 'purchase_order_number'
      then nullif(trim(coalesce(p_payload ->> 'purchase_order_number', '')), '')
    else invoice_row.purchase_order_number
  end;
  next_payment_terms := case
    when p_payload ? 'payment_terms'
      then nullif(trim(coalesce(p_payload ->> 'payment_terms', '')), '')
    else invoice_row.payment_terms
  end;
  next_notes := case
    when p_payload ? 'notes' then nullif(trim(coalesce(p_payload ->> 'notes', '')), '')
    else invoice_row.notes
  end;
  next_internal_notes := case
    when p_payload ? 'internal_notes'
      then nullif(trim(coalesce(p_payload ->> 'internal_notes', '')), '')
    else invoice_row.internal_notes
  end;

  if next_currency !~ '^[A-Z]{3}$' then
    raise exception 'Invoice currency must be a 3-letter ISO code'
      using errcode = '22023';
  end if;

  if next_discount_cents < 0 then
    raise exception 'Invoice discount_cents must be non-negative'
      using errcode = '22023';
  end if;

  if next_due_on < next_issue_on then
    raise exception 'Invoice due_on cannot be before issue_on'
      using errcode = '22023';
  end if;

  if next_currency is distinct from invoice_row.currency and p_lines is null then
    raise exception 'Changing invoice currency requires replacing lines'
      using errcode = '22023';
  end if;

  -- Draft party changes rebuild the snapshot immediately. Quote-derived invoices
  -- keep their accepted snapshot until a client/contact change; Send then
  -- preserves whatever snapshot is stored (never re-reads mutable live parties).
  next_party_snapshot := invoice_row.party_snapshot;
  if next_client_id is distinct from invoice_row.client_id
    or next_contact_id is distinct from invoice_row.contact_id
  then
    select * into client_row
    from public.clients
    where clients.id = next_client_id
      and clients.org_id = p_org_id;

    if not found then
      raise exception 'Invoice client not found'
        using errcode = 'P0002';
    end if;

    contact_row := null;
    if next_contact_id is not null then
      select * into contact_row
      from public.contacts
      where contacts.id = next_contact_id
        and contacts.org_id = p_org_id;

      if not found then
        raise exception 'Invoice contact not found'
          using errcode = 'P0002';
      end if;
    end if;

    next_party_snapshot := jsonb_build_object(
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

  perform set_config('app.allow_invoice_totals', 'on', true);

  if p_lines is not null then
    select * into line_totals
    from private.replace_invoice_lines(
      p_org_id,
      invoice_row.id,
      actor_id,
      p_lines,
      next_currency
    );
    next_subtotal := line_totals.subtotal_cents;
    next_tax := line_totals.tax_cents;
  else
    select
      coalesce(sum(invoice_lines.subtotal_cents), 0),
      coalesce(sum(invoice_lines.tax_cents), 0)
    into next_subtotal, next_tax
    from public.invoice_lines
    where invoice_lines.invoice_id = invoice_row.id;
  end if;

  if next_discount_cents > next_subtotal then
    raise exception 'Invoice discount_cents cannot exceed subtotal_cents'
      using errcode = '23514';
  end if;

  perform private.assert_json_safe_cents(
    next_subtotal - next_discount_cents + next_tax,
    'Invoice total_cents'
  );

  update public.invoices
  set
    client_id = next_client_id,
    contact_id = next_contact_id,
    owner_membership_id = next_owner_membership_id,
    currency = next_currency,
    issue_on = next_issue_on,
    due_on = next_due_on,
    purchase_order_number = next_purchase_order_number,
    discount_cents = next_discount_cents,
    subtotal_cents = next_subtotal,
    tax_cents = next_tax,
    total_cents = next_subtotal - next_discount_cents + next_tax,
    balance_due_cents = next_subtotal - next_discount_cents + next_tax,
    party_snapshot = next_party_snapshot,
    payment_terms = next_payment_terms,
    notes = next_notes,
    internal_notes = next_internal_notes,
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

  return jsonb_build_object(
    'invoice', to_jsonb(invoice_row),
    'lines', lines_json
  );
end;
$$;

create or replace function public.get_invoice_document(
  p_invoice_id uuid,
  p_org_id uuid,
  p_actor_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  jwt_uid uuid := auth.uid();
  actor_id uuid;
  invoice_row public.invoices;
  lines_json jsonb;
begin
  if jwt_uid is not null then
    actor_id := jwt_uid;
    if not private.has_org_role(p_org_id, array['owner', 'admin', 'member', 'billing', 'readonly']) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
  elsif auth.role() = 'service_role' then
    if p_actor_id is null then
      raise exception 'Authentication is required'
        using errcode = '42501';
    end if;
    if not exists (
      select 1
      from public.memberships
      join public.organisations
        on organisations.id = memberships.org_id
      where memberships.org_id = p_org_id
        and memberships.user_id = p_actor_id
        and memberships.status = 'active'
        and organisations.deleted_at is null
        and memberships.role = any (array['owner', 'admin', 'member', 'billing', 'readonly'])
    ) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
    actor_id := p_actor_id;
  else
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  -- Lock the header for the duration of this transaction so a concurrent
  -- save cannot replace lines between header and line reads.
  select * into invoice_row
  from public.invoices
  where invoices.id = p_invoice_id
    and invoices.org_id = p_org_id
    and invoices.deleted_at is null
  for share;

  if not found then
    raise exception 'Invoice not found'
      using errcode = 'P0002';
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(invoice_lines) order by invoice_lines.position, invoice_lines.id),
    '[]'::jsonb
  )
  into lines_json
  from public.invoice_lines
  where invoice_lines.invoice_id = invoice_row.id
    and invoice_lines.org_id = invoice_row.org_id;

  return jsonb_build_object(
    'invoice', to_jsonb(invoice_row),
    'lines', lines_json
  );
end;
$$;

revoke all on function public.create_quote_draft(uuid, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.create_quote_draft(uuid, jsonb, jsonb, uuid) to authenticated, service_role;
revoke all on function public.save_quote_draft(uuid, uuid, integer, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.save_quote_draft(uuid, uuid, integer, jsonb, jsonb, uuid) to authenticated, service_role;
revoke all on function public.get_quote_document(uuid, uuid, uuid) from public, anon;
grant execute on function public.get_quote_document(uuid, uuid, uuid) to authenticated, service_role;
revoke all on function public.create_invoice_draft(uuid, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.create_invoice_draft(uuid, jsonb, jsonb, uuid) to authenticated, service_role;
revoke all on function public.save_invoice_draft(uuid, uuid, integer, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.save_invoice_draft(uuid, uuid, integer, jsonb, jsonb, uuid) to authenticated, service_role;
revoke all on function public.get_invoice_document(uuid, uuid, uuid) from public, anon;
grant execute on function public.get_invoice_document(uuid, uuid, uuid) to authenticated, service_role;

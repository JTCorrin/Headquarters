-- Multi-Contact-BE review fixes (#147):
-- 1) financial_document_envelope keeps recipients[] for idempotent accept/send
-- 2) reject_quote returns recipients[]
-- 3) convert + send rebuild party_snapshot.contacts[] when missing
-- 4) recurring generate return includes recipients[]

-- ---------------------------------------------------------------------------
-- Idempotency envelope: preserve recipients on quote/invoice documents
-- ---------------------------------------------------------------------------

create or replace function private.financial_document_envelope(
  p_doc jsonb,
  p_entity_key text
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_flat jsonb;
  v_headers jsonb;
  v_body jsonb;
begin
  v_flat := coalesce(p_doc -> p_entity_key, '{}'::jsonb)
    || jsonb_build_object(
      'lines', coalesce(p_doc -> 'lines', '[]'::jsonb)
    );

  -- Quotes/invoices carry recipients[]; bills and other entities omit the key.
  if p_entity_key in ('quote', 'invoice') or p_doc ? 'recipients' then
    v_flat := v_flat || jsonb_build_object(
      'recipients', coalesce(p_doc -> 'recipients', '[]'::jsonb)
    );
  end if;

  v_headers := jsonb_build_object(
    'etag', '"' || coalesce(v_flat ->> 'version', '0') || '"'
  );
  v_body := jsonb_build_object(
    'status', 200,
    'body', jsonb_build_object('data', v_flat),
    'headers', v_headers
  );
  return v_body;
end;
$$;

revoke all on function private.financial_document_envelope(jsonb, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- reject_quote: include recipients[]
-- ---------------------------------------------------------------------------

create or replace function public.reject_quote(
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
    raise exception 'Only draft or sent quotes can be rejected'
      using errcode = '22023';
  end if;

  perform set_config('app.allow_quote_lifecycle', 'on', true);
  perform set_config('app.allow_quote_totals', 'on', true);

  update public.quotes
  set
    status = 'rejected',
    rejected_at = now(),
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

  perform private.append_timeline_event(
    quote_row.org_id,
    'quote',
    quote_row.id,
    'status',
    'Quote rejected',
    null,
    actor_id,
    'quote',
    quote_row.id,
    jsonb_build_object(
      'action', 'quote.rejected',
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
      'Quote rejected',
      format('Quote %s', quote_row.number),
      actor_id,
      'quote',
      quote_row.id,
      jsonb_build_object(
        'action', 'quote.rejected',
        'quote_id', quote_row.id,
        'number', quote_row.number,
        'client_id', quote_row.client_id
      )
    );
  end if;

  return jsonb_build_object(
    'quote', to_jsonb(quote_row),
    'lines', lines_json,
    'recipients', private.quote_recipients_json(p_org_id, quote_row.id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- send_invoice: rebuild snapshot when contacts[] missing (pre-migration freeze)
-- ---------------------------------------------------------------------------

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

  -- Quote-derived invoices keep an already-complete snapshot (client + contacts[]).
  -- Rebuild when contacts[] is missing (pre-migration singular freezes) or for
  -- manual/recurring drafts that still have '{}'.
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

-- ---------------------------------------------------------------------------
-- create_invoice_from_quote: rebuild party_snapshot with contacts[] after copy
-- ---------------------------------------------------------------------------

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
  next_party_snapshot jsonb;
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
        'recipients', private.invoice_recipients_json(p_org_id, invoice_row.id),
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

  -- Prefer quote snapshot when it already has contacts[]; otherwise rebuild after
  -- recipient copy (handles pre-migration singular freezes).
  next_party_snapshot := quote_row.party_snapshot;

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
    next_party_snapshot,
    quote_row.notes,
    actor_id,
    actor_id
  )
  returning * into invoice_row;

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

  perform private.copy_quote_recipients_to_invoice(
    p_org_id, quote_row.id, invoice_row.id, actor_id
  );

  if not (invoice_row.party_snapshot ? 'contacts') then
    update public.invoices
    set
      party_snapshot = private.build_receivable_party_snapshot(
        p_org_id,
        invoice_row.client_id,
        invoice_row.contact_id,
        private.invoice_recipient_contact_ids(p_org_id, invoice_row.id)
      ),
      updated_by = actor_id
    where invoices.id = invoice_row.id
    returning * into invoice_row;
  end if;

  perform set_config('app.allow_invoice_totals', 'off', true);

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
    'recipients', private.invoice_recipients_json(p_org_id, invoice_row.id),
    'created', true
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- recurring generate: include recipients[] in return
-- ---------------------------------------------------------------------------

create or replace function private.generate_invoice_from_recurring_run(
  p_org_id uuid,
  p_schedule public.recurring_invoice_schedules,
  p_run public.recurring_invoice_runs,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice_row public.invoices;
  allocated_number text;
  lines_json jsonb := '[]'::jsonb;
  invoice_lines_payload jsonb := '[]'::jsonb;
  line_row public.recurring_invoice_lines;
  description text;
  line_totals record;
  issue_on date := p_run.occurrence_local_date;
  due_on date := p_run.occurrence_local_date + p_schedule.due_days;
begin
  for line_row in
    select *
    from public.recurring_invoice_lines
    where schedule_id = p_schedule.id
      and org_id = p_org_id
      and deleted_at is null
      and active
    order by position, id
  loop
    description := line_row.description_template;
    description := replace(description, '{{period_start}}', p_run.period_start::text);
    description := replace(description, '{{period_end}}', p_run.period_end::text);
    description := replace(description, '{{issue_date}}', issue_on::text);
    if char_length(description) > 200 then
      description := left(description, 200);
    end if;

    invoice_lines_payload := invoice_lines_payload || jsonb_build_array(
      jsonb_build_object(
        'product_id', line_row.product_id,
        'description', description,
        'quantity', line_row.quantity,
        'unit_price_cents', line_row.unit_price_cents,
        'discount_percent', line_row.discount_percent,
        'tax_rate_percent', line_row.tax_rate_percent,
        'position', line_row.position
      )
    );
  end loop;

  if jsonb_array_length(invoice_lines_payload) < 1 then
    raise exception 'Recurring run requires at least one active line'
      using errcode = '22023';
  end if;

  allocated_number := private.allocate_document_number(p_org_id, 'invoice');

  perform set_config('app.allow_invoice_totals', 'on', true);

  insert into public.invoices (
    org_id, number, client_id, contact_id, owner_membership_id,
    source, recurring_run_id, status, currency, issue_on, due_on,
    billing_period_start, billing_period_end,
    purchase_order_number, subtotal_cents, discount_cents, tax_cents,
    total_cents, paid_cents, balance_due_cents, party_snapshot,
    payment_terms, notes, internal_notes, created_by, updated_by
  ) values (
    p_org_id, allocated_number, p_schedule.client_id, p_schedule.contact_id,
    p_schedule.owner_membership_id, 'recurring', p_run.id, 'draft',
    p_schedule.currency, issue_on, due_on,
    p_run.period_start, p_run.period_end,
    p_schedule.purchase_order_number, 0, 0, 0, 0, 0, 0, '{}'::jsonb,
    p_schedule.payment_terms, p_schedule.notes, p_schedule.internal_notes,
    p_actor_id, p_actor_id
  )
  returning * into invoice_row;

  perform private.copy_schedule_recipients_to_invoice(
    p_org_id, p_schedule.id, invoice_row.id, p_actor_id
  );

  select * into line_totals
  from private.replace_invoice_lines(
    p_org_id, invoice_row.id, p_actor_id, invoice_lines_payload, p_schedule.currency
  );

  perform private.assert_json_safe_cents(
    line_totals.subtotal_cents + line_totals.tax_cents,
    'Invoice total_cents'
  );

  update public.invoices
  set
    subtotal_cents = line_totals.subtotal_cents,
    tax_cents = line_totals.tax_cents,
    total_cents = line_totals.subtotal_cents + line_totals.tax_cents,
    balance_due_cents = line_totals.subtotal_cents + line_totals.tax_cents,
    updated_by = p_actor_id
  where id = invoice_row.id
  returning * into invoice_row;

  select coalesce(
    jsonb_agg(to_jsonb(invoice_lines) order by invoice_lines.position, invoice_lines.id),
    '[]'::jsonb
  )
  into lines_json
  from public.invoice_lines
  where invoice_id = invoice_row.id;

  perform set_config('app.allow_invoice_totals', 'off', true);

  return jsonb_build_object(
    'invoice', to_jsonb(invoice_row),
    'lines', lines_json,
    'recipients', private.invoice_recipients_json(p_org_id, invoice_row.id)
  );
end;
$$;

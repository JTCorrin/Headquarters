-- Optional custom invoice number on create (with sequence sync) + optional sent_at on send.

-- ---------------------------------------------------------------------------
-- Resolve invoice number: custom payload or allocate; bump sequence when custom
-- matches org prefix + numeric suffix so later auto-allocates cannot collide.
-- ---------------------------------------------------------------------------

create or replace function private.resolve_invoice_document_number(
  p_org_id uuid,
  p_custom text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  custom text := nullif(trim(coalesce(p_custom, '')), '');
  seq_row public.document_sequences;
  suffix text;
  parsed bigint;
begin
  if custom is null then
    return private.allocate_document_number(p_org_id, 'invoice');
  end if;

  if char_length(custom) < 1 or char_length(custom) > 64 then
    raise exception 'Invoice number must be between 1 and 64 characters'
      using errcode = '22023';
  end if;

  select * into seq_row
  from public.document_sequences
  where document_sequences.org_id = p_org_id
    and document_sequences.document_type = 'invoice'
  for update;

  if not found then
    insert into public.document_sequences (
      org_id,
      document_type,
      prefix,
      next_number,
      padding
    )
    values (p_org_id, 'invoice', 'INV-', 1, 4)
    on conflict (org_id, document_type) do nothing;

    select * into seq_row
    from public.document_sequences
    where document_sequences.org_id = p_org_id
      and document_sequences.document_type = 'invoice'
    for update;
  end if;

  if found
    and seq_row.prefix is not null
    and left(custom, char_length(seq_row.prefix)) = seq_row.prefix
  then
    suffix := substring(custom from char_length(seq_row.prefix) + 1);
    if suffix ~ '^[0-9]+$' then
      parsed := suffix::bigint;
      if parsed >= seq_row.next_number then
        update public.document_sequences
        set next_number = parsed + 1
        where document_sequences.org_id = p_org_id
          and document_sequences.document_type = 'invoice';
      end if;
    end if;
  end if;

  return custom;
end;
$$;

revoke all on function private.resolve_invoice_document_number(uuid, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_invoice_draft: honour optional payload.number
-- ---------------------------------------------------------------------------

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
  recipients_json jsonb;
  line_totals record;
  recipients_input jsonb;
  billing_contact_id uuid;
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
  recipients_input := private.resolve_recipients_input(p_payload, true);
  billing_contact_id := null;
  if jsonb_array_length(recipients_input) > 0 then
    select n.contact_id into billing_contact_id
    from private.normalize_recipients_array(p_org_id, recipients_input) n
    where n.is_billing
    limit 1;
    contact_id := billing_contact_id;
  else
    contact_id := null;
  end if;
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

  allocated_number := private.resolve_invoice_document_number(
    p_org_id,
    p_payload ->> 'number'
  );

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

  perform private.replace_invoice_recipients(
    p_org_id, invoice_row.id, actor_id, recipients_input
  );
  select * into invoice_row from public.invoices where invoices.id = invoice_row.id;
  recipients_json := private.invoice_recipients_json(p_org_id, invoice_row.id);

  return jsonb_build_object(
    'invoice', to_jsonb(invoice_row),
    'lines', lines_json,
    'recipients', recipients_json
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- send_invoice: optional p_sent_at (4-arg). Keep 3-arg wrapper for callers.
-- ---------------------------------------------------------------------------

create or replace function public.send_invoice(
  p_invoice_id uuid,
  p_org_id uuid,
  p_expected_version integer,
  p_sent_at timestamptz
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
  effective_sent_at timestamptz := coalesce(p_sent_at, now());
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

-- 3-arg compatibility wrapper (existing callers + privilege checks).
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
begin
  return public.send_invoice(p_invoice_id, p_org_id, p_expected_version, null);
end;
$$;

revoke all on function public.send_invoice(uuid, uuid, integer, timestamptz)
  from public, anon;
grant execute on function public.send_invoice(uuid, uuid, integer, timestamptz)
  to authenticated, service_role;

revoke all on function public.send_invoice(uuid, uuid, integer)
  from public, anon;
grant execute on function public.send_invoice(uuid, uuid, integer)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- send_invoice_idempotent: thread optional p_sent_at
-- ---------------------------------------------------------------------------

drop function if exists public.send_invoice_idempotent(
  uuid, uuid, integer, text, text, text, integer
);

create or replace function public.send_invoice_idempotent(
  p_invoice_id uuid,
  p_org_id uuid,
  p_expected_version integer,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_route text,
  p_ttl_seconds integer default 86400,
  p_sent_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replay jsonb;
  v_doc jsonb;
  v_stored jsonb;
begin
  v_replay := private.idempotency_claim_or_replay(
    p_org_id, p_idempotency_key_hash, p_request_hash, p_route, p_ttl_seconds
  );
  if v_replay is not null then
    return v_replay;
  end if;

  v_doc := public.send_invoice(
    p_invoice_id, p_org_id, p_expected_version, p_sent_at
  );
  v_stored := private.financial_document_envelope(v_doc, 'invoice');
  perform private.idempotency_store_response(
    p_org_id, p_idempotency_key_hash, 200, v_stored, 'invoice', p_invoice_id
  );

  return jsonb_build_object(
    'replay', false,
    'response_status', 200,
    'response_body', v_stored -> 'body',
    'response_headers', v_stored -> 'headers'
  );
end;
$$;

revoke all on function public.send_invoice_idempotent(
  uuid, uuid, integer, text, text, text, integer, timestamptz
) from public, anon;
grant execute on function public.send_invoice_idempotent(
  uuid, uuid, integer, text, text, text, integer, timestamptz
) to authenticated, service_role;

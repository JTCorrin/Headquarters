-- API-key / service_role support for invoice send/void and payment create.
-- Same actor pattern as create_invoice_draft: JWT uses auth.uid(); service_role
-- accepts optional p_actor_id (API key creator), falling back to an org owner
-- so existing edge handlers that omit p_actor_id still work after this migration.

create or replace function private.resolve_org_actor(
  p_org_id uuid,
  p_actor_id uuid default null,
  p_roles text[] default array['owner', 'admin', 'member']
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  jwt_uid uuid := auth.uid();
  actor_id uuid;
begin
  if jwt_uid is not null then
    if not private.has_org_role(p_org_id, p_roles) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
    return jwt_uid;
  end if;

  if auth.role() is distinct from 'service_role' then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  actor_id := p_actor_id;
  if actor_id is null then
    select memberships.user_id
      into actor_id
    from public.memberships
    join public.organisations
      on organisations.id = memberships.org_id
    where memberships.org_id = p_org_id
      and memberships.status = 'active'
      and organisations.deleted_at is null
      and memberships.role = 'owner'
    order by memberships.created_at asc
    limit 1;
  end if;

  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.memberships
    join public.organisations
      on organisations.id = memberships.org_id
    where memberships.org_id = p_org_id
      and memberships.user_id = actor_id
      and memberships.status = 'active'
      and organisations.deleted_at is null
      and memberships.role = any (p_roles)
  ) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  return actor_id;
end;
$$;

revoke all on function private.resolve_org_actor(uuid, uuid, text[])
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Idempotency helpers: accept optional p_actor_id for service_role
-- ---------------------------------------------------------------------------

drop function if exists private.idempotency_claim_or_replay(
  uuid, text, text, text, integer
);

create or replace function private.idempotency_claim_or_replay(
  p_org_id uuid,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_route text,
  p_ttl_seconds integer default 86400,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_existing public.api_idempotency_keys;
  v_expires_at timestamptz := now() + make_interval(secs => greatest(coalesce(p_ttl_seconds, 86400), 60));
begin
  v_actor_id := private.resolve_org_actor(p_org_id, p_actor_id);

  if p_org_id is null
    or p_idempotency_key_hash is null
    or char_length(p_idempotency_key_hash) <> 64
    or p_request_hash is null
    or char_length(p_request_hash) <> 64
    or p_route is null
    or char_length(p_route) < 1
  then
    raise exception 'Idempotency claim parameters are invalid' using errcode = '22023';
  end if;

  loop
    select * into v_existing
    from public.api_idempotency_keys
    where api_idempotency_keys.org_id = p_org_id
      and api_idempotency_keys.actor_type = 'user'
      and api_idempotency_keys.actor_id = v_actor_id
      and api_idempotency_keys.idempotency_key_hash = p_idempotency_key_hash
    for update;

    if found then
      if v_existing.expires_at > now() then
        if v_existing.request_hash is distinct from p_request_hash
          or v_existing.route is distinct from p_route
        then
          raise exception 'Idempotency-Key was reused with a different request payload'
            using errcode = '23505';
        end if;
        if v_existing.response_status is not null and v_existing.response_body is not null then
          return jsonb_build_object(
            'replay', true,
            'response_status', v_existing.response_status,
            'response_body', v_existing.response_body -> 'body',
            'response_headers', coalesce(v_existing.response_body -> 'headers', '{}'::jsonb)
          );
        end if;
        raise exception 'An identical request is already in progress' using errcode = '55000';
      end if;
      delete from public.api_idempotency_keys where id = v_existing.id;
    end if;

    begin
      insert into public.api_idempotency_keys (
        org_id, actor_type, actor_id, idempotency_key_hash, route, request_hash, expires_at
      ) values (
        p_org_id, 'user', v_actor_id, p_idempotency_key_hash, p_route, p_request_hash, v_expires_at
      );
      exit;
    exception
      when unique_violation then
        null;
    end;
  end loop;

  return null;
end;
$$;

revoke all on function private.idempotency_claim_or_replay(
  uuid, text, text, text, integer, uuid
) from public, anon, authenticated;

drop function if exists private.idempotency_store_response(
  uuid, text, integer, jsonb, text, uuid
);

create or replace function private.idempotency_store_response(
  p_org_id uuid,
  p_idempotency_key_hash text,
  p_response_status integer,
  p_response_body jsonb,
  p_resource_type text,
  p_resource_id uuid,
  p_actor_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
begin
  v_actor_id := coalesce(auth.uid(), p_actor_id);
  if v_actor_id is null and auth.role() = 'service_role' then
    v_actor_id := private.resolve_org_actor(p_org_id, null);
  end if;
  if v_actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  update public.api_idempotency_keys
  set
    response_status = p_response_status,
    response_body = p_response_body,
    resource_type = p_resource_type,
    resource_id = p_resource_id
  where api_idempotency_keys.org_id = p_org_id
    and api_idempotency_keys.actor_type = 'user'
    and api_idempotency_keys.actor_id = v_actor_id
    and api_idempotency_keys.idempotency_key_hash = p_idempotency_key_hash;
end;
$$;

revoke all on function private.idempotency_store_response(
  uuid, text, integer, jsonb, text, uuid, uuid
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- send_invoice (+ wrappers)
-- ---------------------------------------------------------------------------

drop function if exists public.send_invoice(uuid, uuid, integer, timestamptz);
drop function if exists public.send_invoice(uuid, uuid, integer);
drop function if exists public.send_invoice_idempotent(
  uuid, uuid, integer, text, text, text, integer, timestamptz
);
drop function if exists public.send_invoice_idempotent(
  uuid, uuid, integer, text, text, text, integer
);

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
  return public.send_invoice(p_invoice_id, p_org_id, p_expected_version, null, null);
end;
$$;

revoke all on function public.send_invoice(uuid, uuid, integer, timestamptz, uuid)
  from public, anon;
grant execute on function public.send_invoice(uuid, uuid, integer, timestamptz, uuid)
  to authenticated, service_role;

revoke all on function public.send_invoice(uuid, uuid, integer)
  from public, anon;
grant execute on function public.send_invoice(uuid, uuid, integer)
  to authenticated, service_role;

create or replace function public.send_invoice_idempotent(
  p_invoice_id uuid,
  p_org_id uuid,
  p_expected_version integer,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_route text,
  p_ttl_seconds integer default 86400,
  p_sent_at timestamptz default null,
  p_actor_id uuid default null
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
    p_org_id, p_idempotency_key_hash, p_request_hash, p_route, p_ttl_seconds, p_actor_id
  );
  if v_replay is not null then
    return v_replay;
  end if;

  v_doc := public.send_invoice(
    p_invoice_id, p_org_id, p_expected_version, p_sent_at, p_actor_id
  );
  v_stored := private.financial_document_envelope(v_doc, 'invoice');
  perform private.idempotency_store_response(
    p_org_id, p_idempotency_key_hash, 200, v_stored, 'invoice', p_invoice_id, p_actor_id
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
  uuid, uuid, integer, text, text, text, integer, timestamptz, uuid
) from public, anon;
grant execute on function public.send_invoice_idempotent(
  uuid, uuid, integer, text, text, text, integer, timestamptz, uuid
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- void_invoice (+ idempotent)
-- ---------------------------------------------------------------------------

drop function if exists public.void_invoice(uuid, uuid, integer, text);
drop function if exists public.void_invoice_idempotent(
  uuid, uuid, integer, text, text, text, text, integer
);

create or replace function public.void_invoice(
  p_invoice_id uuid,
  p_org_id uuid,
  p_expected_version integer,
  p_void_reason text,
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
  reason text;
  lines_json jsonb;
begin
  actor_id := private.resolve_org_actor(p_org_id, p_actor_id);

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
    'lines', lines_json,
    'recipients', private.invoice_recipients_json(p_org_id, invoice_row.id)
  );
end;
$$;

revoke all on function public.void_invoice(uuid, uuid, integer, text, uuid)
  from public, anon;
grant execute on function public.void_invoice(uuid, uuid, integer, text, uuid)
  to authenticated, service_role;

create or replace function public.void_invoice_idempotent(
  p_invoice_id uuid,
  p_org_id uuid,
  p_expected_version integer,
  p_void_reason text,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_route text,
  p_ttl_seconds integer default 86400,
  p_actor_id uuid default null
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
    p_org_id, p_idempotency_key_hash, p_request_hash, p_route, p_ttl_seconds, p_actor_id
  );
  if v_replay is not null then
    return v_replay;
  end if;

  v_doc := public.void_invoice(
    p_invoice_id, p_org_id, p_expected_version, p_void_reason, p_actor_id
  );
  v_stored := private.financial_document_envelope(v_doc, 'invoice');
  perform private.idempotency_store_response(
    p_org_id, p_idempotency_key_hash, 200, v_stored, 'invoice', p_invoice_id, p_actor_id
  );

  return jsonb_build_object(
    'replay', false,
    'response_status', 200,
    'response_body', v_stored -> 'body',
    'response_headers', v_stored -> 'headers'
  );
end;
$$;

revoke all on function public.void_invoice_idempotent(
  uuid, uuid, integer, text, text, text, text, integer, uuid
) from public, anon;
grant execute on function public.void_invoice_idempotent(
  uuid, uuid, integer, text, text, text, text, integer, uuid
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- create_payment (+ idempotent)
-- ---------------------------------------------------------------------------

drop function if exists public.create_payment(uuid, jsonb, jsonb);
drop function if exists public.create_payment_idempotent(
  uuid, jsonb, jsonb, text, text, text, integer
);

create or replace function public.create_payment(
  p_org_id uuid,
  p_payload jsonb,
  p_allocations jsonb default '[]'::jsonb,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  direction text;
  client_id uuid;
  vendor_id uuid;
  amount_cents bigint;
  currency text;
  method text;
  occurred_on date;
  reference text;
  provider text;
  provider_payment_id text;
  notes text;
  metadata jsonb;
  payment_row public.payments;
begin
  v_actor_id := private.resolve_org_actor(p_org_id, p_actor_id);

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Payment payload is required' using errcode = '22023';
  end if;

  direction := nullif(trim(coalesce(p_payload ->> 'direction', '')), '');
  if direction is null or direction not in ('inbound', 'outbound') then
    raise exception 'direction must be inbound or outbound' using errcode = '22023';
  end if;

  client_id := nullif(p_payload ->> 'client_id', '')::uuid;
  vendor_id := nullif(p_payload ->> 'vendor_id', '')::uuid;
  amount_cents := (p_payload ->> 'amount_cents')::bigint;
  currency := upper(nullif(trim(coalesce(p_payload ->> 'currency', '')), ''));
  method := nullif(trim(coalesce(p_payload ->> 'method', '')), '');
  occurred_on := coalesce(
    nullif(p_payload ->> 'occurred_on', '')::date,
    (timezone('utc', now()))::date
  );
  reference := nullif(trim(coalesce(p_payload ->> 'reference', '')), '');
  provider := coalesce(nullif(trim(coalesce(p_payload ->> 'provider', '')), ''), 'manual');
  provider_payment_id := nullif(trim(coalesce(p_payload ->> 'provider_payment_id', '')), '');
  notes := nullif(trim(coalesce(p_payload ->> 'notes', '')), '');
  metadata := coalesce(p_payload -> 'metadata', '{}'::jsonb);

  if amount_cents is null or amount_cents <= 0 then
    raise exception 'amount_cents must be greater than zero' using errcode = '22023';
  end if;
  if currency is null or currency !~ '^[A-Z]{3}$' then
    raise exception 'currency must be a 3-letter ISO code' using errcode = '22023';
  end if;
  if method is null or method not in ('bank', 'card', 'cash', 'stripe', 'other') then
    raise exception 'method is invalid' using errcode = '22023';
  end if;
  if jsonb_typeof(metadata) <> 'object' then
    raise exception 'metadata must be an object' using errcode = '22023';
  end if;

  if direction = 'inbound' then
    if client_id is null then
      raise exception 'client_id is required for inbound payments' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.clients
      where id = client_id and org_id = p_org_id and deleted_at is null
    ) then
      raise exception 'Client not found' using errcode = 'P0002';
    end if;
    vendor_id := null;
  else
    if vendor_id is null then
      raise exception 'vendor_id is required for outbound payments' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.vendors
      where id = vendor_id and org_id = p_org_id and deleted_at is null
    ) then
      raise exception 'Vendor not found' using errcode = 'P0002';
    end if;
    client_id := null;
  end if;

  insert into public.payments (
    org_id, direction, client_id, vendor_id, amount_cents, currency, method,
    status, occurred_on, reference, provider, provider_payment_id, notes,
    metadata, created_by, updated_by
  ) values (
    p_org_id, direction, client_id, vendor_id, amount_cents, currency, method,
    'unallocated', occurred_on, reference, provider, provider_payment_id, notes,
    metadata, v_actor_id, v_actor_id
  )
  returning * into payment_row;

  if p_allocations is not null
    and jsonb_typeof(p_allocations) = 'array'
    and jsonb_array_length(p_allocations) > 0
  then
    perform private.apply_payment_allocations(
      p_org_id, payment_row.id, p_allocations, v_actor_id
    );
  end if;

  return private.payment_document(payment_row.id, p_org_id);
end;
$$;

revoke all on function public.create_payment(uuid, jsonb, jsonb, uuid)
  from public, anon;
grant execute on function public.create_payment(uuid, jsonb, jsonb, uuid)
  to authenticated, service_role;

create or replace function public.create_payment_idempotent(
  p_org_id uuid,
  p_payload jsonb,
  p_allocations jsonb,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_route text,
  p_ttl_seconds integer default 86400,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_existing public.api_idempotency_keys;
  v_expires_at timestamptz := now() + make_interval(secs => greatest(coalesce(p_ttl_seconds, 86400), 60));
  doc jsonb;
  payment_id uuid;
  v_response_headers jsonb;
  v_response_body jsonb;
begin
  v_actor_id := private.resolve_org_actor(p_org_id, p_actor_id);

  if p_org_id is null
    or p_idempotency_key_hash is null
    or char_length(p_idempotency_key_hash) <> 64
    or p_request_hash is null
    or char_length(p_request_hash) <> 64
    or p_route is null
    or char_length(p_route) < 1
  then
    raise exception 'Idempotency claim parameters are invalid' using errcode = '22023';
  end if;

  loop
    select * into v_existing
    from public.api_idempotency_keys
    where api_idempotency_keys.org_id = p_org_id
      and api_idempotency_keys.actor_type = 'user'
      and api_idempotency_keys.actor_id = v_actor_id
      and api_idempotency_keys.idempotency_key_hash = p_idempotency_key_hash
    for update;

    if found then
      if v_existing.expires_at > now() then
        if v_existing.request_hash is distinct from p_request_hash
          or v_existing.route is distinct from p_route
        then
          raise exception 'Idempotency-Key was reused with a different request payload'
            using errcode = '23505';
        end if;
        if v_existing.response_status is not null and v_existing.response_body is not null then
          return jsonb_build_object(
            'replay', true,
            'response_status', v_existing.response_status,
            'response_body', v_existing.response_body -> 'body',
            'response_headers', coalesce(v_existing.response_body -> 'headers', '{}'::jsonb)
          );
        end if;
        raise exception 'An identical request is already in progress' using errcode = '55000';
      end if;
      delete from public.api_idempotency_keys where id = v_existing.id;
    end if;

    begin
      insert into public.api_idempotency_keys (
        org_id, actor_type, actor_id, idempotency_key_hash, route, request_hash, expires_at
      ) values (
        p_org_id, 'user', v_actor_id, p_idempotency_key_hash, p_route, p_request_hash, v_expires_at
      );
      exit;
    exception
      when unique_violation then
        null;
    end;
  end loop;

  doc := public.create_payment(
    p_org_id, p_payload, coalesce(p_allocations, '[]'::jsonb), p_actor_id
  );
  payment_id := (doc -> 'payment' ->> 'id')::uuid;

  v_response_headers := jsonb_build_object(
    'etag', '"' || (doc -> 'payment' ->> 'version') || '"',
    'location', '/api/v1/payments/' || payment_id::text
  );
  v_response_body := jsonb_build_object(
    'status', 201,
    'body', jsonb_build_object(
      'data', (doc -> 'payment') || jsonb_build_object('allocations', doc -> 'allocations')
    ),
    'headers', v_response_headers
  );

  update public.api_idempotency_keys
  set
    response_status = 201,
    response_body = v_response_body,
    resource_type = 'payment',
    resource_id = payment_id
  where api_idempotency_keys.org_id = p_org_id
    and api_idempotency_keys.actor_type = 'user'
    and api_idempotency_keys.actor_id = v_actor_id
    and api_idempotency_keys.idempotency_key_hash = p_idempotency_key_hash;

  return jsonb_build_object(
    'replay', false,
    'response_status', 201,
    'response_body', v_response_body -> 'body',
    'response_headers', v_response_headers
  );
end;
$$;

revoke all on function public.create_payment_idempotent(
  uuid, jsonb, jsonb, text, text, text, integer, uuid
) from public, anon;
grant execute on function public.create_payment_idempotent(
  uuid, jsonb, jsonb, text, text, text, integer, uuid
) to authenticated, service_role;

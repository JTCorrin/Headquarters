-- Payments foundation: payments + payment_allocations ledger (append/reverse),
-- RPCs to create/allocate/reverse, and server-authoritative invoice/bill paid/
-- balance/status transitions. Stripe/webhooks intentionally out of scope.
-- See PLANS/PAYMENTS_FOUNDATION_SLICE.md and CRM_DATA_DICTIONARY §6.11–6.12.

set search_path = public, extensions, pg_catalog;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  version integer not null default 1 check (version > 0),
  direction text not null,
  client_id uuid,
  vendor_id uuid,
  amount_cents bigint not null check (amount_cents > 0),
  currency char(3) not null,
  method text not null,
  status text not null,
  occurred_on date not null,
  reference text,
  provider text not null default 'manual',
  provider_payment_id text,
  notes text,
  reverses_payment_id uuid,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint payments_org_id_id_key unique (org_id, id),
  constraint payments_direction_check
    check (direction in ('inbound', 'outbound')),
  constraint payments_status_check
    check (status in (
      'pending', 'completed', 'unallocated', 'part_allocated',
      'allocated', 'refunded', 'reversed', 'failed'
    )),
  constraint payments_method_check
    check (method in ('bank', 'card', 'cash', 'stripe', 'other')),
  constraint payments_currency_format_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint payments_metadata_object_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint payments_provider_length_check
    check (char_length(provider) between 1 and 64),
  constraint payments_reference_length_check
    check (reference is null or char_length(reference) <= 200),
  constraint payments_provider_payment_id_length_check
    check (provider_payment_id is null or char_length(provider_payment_id) <= 200),
  constraint payments_notes_length_check
    check (notes is null or char_length(notes) <= 4000),
  constraint payments_inbound_client_check
    check (direction <> 'inbound' or client_id is not null),
  constraint payments_outbound_vendor_check
    check (direction <> 'outbound' or vendor_id is not null),
  constraint payments_client_fk
    foreign key (org_id, client_id)
    references public.clients (org_id, id)
    on delete restrict,
  constraint payments_vendor_fk
    foreign key (org_id, vendor_id)
    references public.vendors (org_id, id)
    on delete restrict,
  constraint payments_reverses_payment_fk
    foreign key (org_id, reverses_payment_id)
    references public.payments (org_id, id)
    on delete restrict
);

create unique index payments_org_provider_payment_uidx
  on public.payments (org_id, provider, provider_payment_id)
  where provider_payment_id is not null;

create index payments_org_created_idx
  on public.payments (org_id, created_at desc, id desc);

create index payments_org_direction_status_idx
  on public.payments (org_id, direction, status, occurred_on desc);

create index payments_org_client_idx
  on public.payments (org_id, client_id)
  where client_id is not null;

create index payments_org_vendor_idx
  on public.payments (org_id, vendor_id)
  where vendor_id is not null;

create trigger payments_stamp_business_row
before insert or update on public.payments
for each row execute function private.stamp_business_row();

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  version integer not null default 1 check (version > 0),
  payment_id uuid not null,
  invoice_id uuid,
  bill_id uuid,
  amount_cents bigint not null check (amount_cents > 0),
  allocated_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversal_reason text,
  constraint payment_allocations_org_id_id_key unique (org_id, id),
  constraint payment_allocations_target_xor_check
    check (
      (invoice_id is not null and bill_id is null)
      or (invoice_id is null and bill_id is not null)
    ),
  constraint payment_allocations_reversal_reason_length_check
    check (reversal_reason is null or char_length(reversal_reason) <= 2000),
  constraint payment_allocations_payment_fk
    foreign key (org_id, payment_id)
    references public.payments (org_id, id)
    on delete restrict,
  constraint payment_allocations_invoice_fk
    foreign key (org_id, invoice_id)
    references public.invoices (org_id, id)
    on delete restrict,
  constraint payment_allocations_bill_fk
    foreign key (org_id, bill_id)
    references public.bills (org_id, id)
    on delete restrict
);

create index payment_allocations_payment_idx
  on public.payment_allocations (org_id, payment_id, allocated_at desc);

create index payment_allocations_invoice_idx
  on public.payment_allocations (org_id, invoice_id)
  where invoice_id is not null and reversed_at is null;

create index payment_allocations_bill_idx
  on public.payment_allocations (org_id, bill_id)
  where bill_id is not null and reversed_at is null;

create trigger payment_allocations_stamp_business_row
before insert or update on public.payment_allocations
for each row execute function private.stamp_business_row();

-- ---------------------------------------------------------------------------
-- Private helpers
-- ---------------------------------------------------------------------------

create or replace function private.payment_document(
  p_payment_id uuid,
  p_org_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  payment_row public.payments;
  allocations jsonb;
begin
  select * into payment_row
  from public.payments
  where id = p_payment_id and org_id = p_org_id;

  if not found then
    raise exception 'Payment not found' using errcode = 'P0002';
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(payment_allocations) order by allocated_at, id),
    '[]'::jsonb
  )
  into allocations
  from public.payment_allocations
  where payment_id = p_payment_id
    and org_id = p_org_id;

  return jsonb_build_object(
    'payment', to_jsonb(payment_row),
    'allocations', allocations
  );
end;
$$;

create or replace function private.recompute_payment_allocation_status(
  p_org_id uuid,
  p_payment_id uuid
)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.payments;
  allocated_sum bigint;
  next_status text;
begin
  select * into payment_row
  from public.payments
  where id = p_payment_id and org_id = p_org_id
  for update;

  if not found then
    raise exception 'Payment not found' using errcode = 'P0002';
  end if;

  -- Reversing corrections and terminal statuses keep their status.
  if payment_row.status = 'reversed'
    or payment_row.reverses_payment_id is not null
  then
    return payment_row;
  end if;

  select coalesce(sum(amount_cents), 0) into allocated_sum
  from public.payment_allocations
  where payment_id = p_payment_id
    and org_id = p_org_id
    and reversed_at is null;

  if allocated_sum = 0 then
    next_status := 'unallocated';
  elsif allocated_sum < payment_row.amount_cents then
    next_status := 'part_allocated';
  else
    next_status := 'completed';
  end if;

  update public.payments
  set
    status = next_status,
    completed_at = case
      when next_status = 'completed' then coalesce(payment_row.completed_at, now())
      else null
    end,
    updated_by = auth.uid()
  where id = p_payment_id and org_id = p_org_id
  returning * into payment_row;

  return payment_row;
end;
$$;

create or replace function private.recompute_invoice_payment_state(
  p_org_id uuid,
  p_invoice_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice_row public.invoices;
  paid_sum bigint;
  next_status text;
  next_balance bigint;
begin
  select * into invoice_row
  from public.invoices
  where id = p_invoice_id and org_id = p_org_id and deleted_at is null
  for update;

  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;

  if invoice_row.status in ('draft', 'void') then
    return;
  end if;

  select coalesce(sum(amount_cents), 0) into paid_sum
  from public.payment_allocations
  where invoice_id = p_invoice_id
    and org_id = p_org_id
    and reversed_at is null;

  if paid_sum > invoice_row.total_cents then
    raise exception 'Invoice allocations exceed invoice total'
      using errcode = '22023';
  end if;

  next_balance := invoice_row.total_cents - paid_sum;

  if paid_sum = 0 then
    next_status := 'sent';
  elsif paid_sum < invoice_row.total_cents then
    next_status := 'partial';
  else
    next_status := 'paid';
  end if;

  perform set_config('app.allow_invoice_lifecycle', 'on', true);

  update public.invoices
  set
    paid_cents = paid_sum,
    balance_due_cents = next_balance,
    status = next_status,
    paid_at = case
      when next_status = 'paid' then coalesce(invoice_row.paid_at, now())
      else null
    end,
    updated_by = auth.uid()
  where id = p_invoice_id and org_id = p_org_id;

  perform set_config('app.allow_invoice_lifecycle', 'off', true);
end;
$$;

create or replace function private.recompute_bill_payment_state(
  p_org_id uuid,
  p_bill_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  bill_row public.bills;
  paid_sum bigint;
  next_status text;
  next_balance bigint;
begin
  select * into bill_row
  from public.bills
  where id = p_bill_id and org_id = p_org_id and deleted_at is null
  for update;

  if not found then
    raise exception 'Bill not found' using errcode = 'P0002';
  end if;

  if bill_row.status in ('draft', 'void') then
    return;
  end if;

  select coalesce(sum(amount_cents), 0) into paid_sum
  from public.payment_allocations
  where bill_id = p_bill_id
    and org_id = p_org_id
    and reversed_at is null;

  if paid_sum > bill_row.total_cents then
    raise exception 'Bill allocations exceed bill total'
      using errcode = '22023';
  end if;

  next_balance := bill_row.total_cents - paid_sum;

  if paid_sum = 0 then
    next_status := 'received';
  elsif paid_sum < bill_row.total_cents then
    next_status := 'partial';
  else
    next_status := 'paid';
  end if;

  perform set_config('app.allow_bill_lifecycle', 'on', true);

  update public.bills
  set
    paid_cents = paid_sum,
    balance_due_cents = next_balance,
    status = next_status,
    paid_at = case
      when next_status = 'paid' then coalesce(bill_row.paid_at, now())
      else null
    end,
    updated_by = auth.uid()
  where id = p_bill_id and org_id = p_org_id;

  perform set_config('app.allow_bill_lifecycle', 'off', true);
end;
$$;

create or replace function private.apply_payment_allocations(
  p_org_id uuid,
  p_payment_id uuid,
  p_allocations jsonb,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.payments;
  alloc jsonb;
  alloc_invoice_id uuid;
  alloc_bill_id uuid;
  alloc_amount bigint;
  allocated_sum bigint;
  invoice_row public.invoices;
  bill_row public.bills;
  i integer;
begin
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'allocations must be a JSON array' using errcode = '22023';
  end if;

  select * into payment_row
  from public.payments
  where id = p_payment_id and org_id = p_org_id
  for update;

  if not found then
    raise exception 'Payment not found' using errcode = 'P0002';
  end if;

  if payment_row.status in ('reversed', 'refunded', 'failed')
    or payment_row.reverses_payment_id is not null
  then
    raise exception 'Payment cannot accept allocations in status %', payment_row.status
      using errcode = '22023';
  end if;

  for i in 0 .. greatest(jsonb_array_length(p_allocations) - 1, -1) loop
    alloc := p_allocations -> i;
    alloc_invoice_id := nullif(alloc ->> 'invoice_id', '')::uuid;
    alloc_bill_id := nullif(alloc ->> 'bill_id', '')::uuid;
    alloc_amount := (alloc ->> 'amount_cents')::bigint;

    if alloc_amount is null or alloc_amount <= 0 then
      raise exception 'Allocation amount_cents must be greater than zero'
        using errcode = '22023';
    end if;

    if (alloc_invoice_id is null and alloc_bill_id is null)
      or (alloc_invoice_id is not null and alloc_bill_id is not null)
    then
      raise exception 'Each allocation requires exactly one of invoice_id or bill_id'
        using errcode = '22023';
    end if;

    if alloc_invoice_id is not null then
      if payment_row.direction <> 'inbound' then
        raise exception 'Only inbound payments can allocate to invoices'
          using errcode = '22023';
      end if;

      select * into invoice_row
      from public.invoices
      where id = alloc_invoice_id
        and org_id = p_org_id
        and deleted_at is null
      for update;

      if not found then
        raise exception 'Invoice not found for allocation' using errcode = 'P0002';
      end if;

      if invoice_row.status not in ('sent', 'partial', 'paid') then
        raise exception 'Cannot allocate to invoice in status %', invoice_row.status
          using errcode = '22023';
      end if;

      if invoice_row.currency is distinct from payment_row.currency then
        raise exception 'Allocation currency must match payment and invoice'
          using errcode = '22023';
      end if;

      if payment_row.client_id is distinct from invoice_row.client_id then
        raise exception 'Inbound payment client must match invoice client'
          using errcode = '22023';
      end if;

      if alloc_amount > invoice_row.balance_due_cents then
        raise exception 'Allocation exceeds invoice balance due'
          using errcode = '22023';
      end if;

      insert into public.payment_allocations (
        org_id, payment_id, invoice_id, amount_cents, allocated_at,
        created_by, updated_by
      ) values (
        p_org_id, p_payment_id, alloc_invoice_id, alloc_amount, now(),
        p_actor_id, p_actor_id
      );

      -- Keep balance_due current so later items in the same batch see remaining room.
      perform private.recompute_invoice_payment_state(p_org_id, alloc_invoice_id);
    else
      if payment_row.direction <> 'outbound' then
        raise exception 'Only outbound payments can allocate to bills'
          using errcode = '22023';
      end if;

      select * into bill_row
      from public.bills
      where id = alloc_bill_id
        and org_id = p_org_id
        and deleted_at is null
      for update;

      if not found then
        raise exception 'Bill not found for allocation' using errcode = 'P0002';
      end if;

      if bill_row.status not in ('received', 'partial', 'paid') then
        raise exception 'Cannot allocate to bill in status %', bill_row.status
          using errcode = '22023';
      end if;

      if bill_row.currency is distinct from payment_row.currency then
        raise exception 'Allocation currency must match payment and bill'
          using errcode = '22023';
      end if;

      if payment_row.vendor_id is distinct from bill_row.vendor_id then
        raise exception 'Outbound payment vendor must match bill vendor'
          using errcode = '22023';
      end if;

      if alloc_amount > bill_row.balance_due_cents then
        raise exception 'Allocation exceeds bill balance due'
          using errcode = '22023';
      end if;

      insert into public.payment_allocations (
        org_id, payment_id, bill_id, amount_cents, allocated_at,
        created_by, updated_by
      ) values (
        p_org_id, p_payment_id, alloc_bill_id, alloc_amount, now(),
        p_actor_id, p_actor_id
      );

      perform private.recompute_bill_payment_state(p_org_id, alloc_bill_id);
    end if;

    select coalesce(sum(amount_cents), 0) into allocated_sum
    from public.payment_allocations
    where payment_id = p_payment_id
      and org_id = p_org_id
      and reversed_at is null;

    if allocated_sum > payment_row.amount_cents then
      raise exception 'Allocations exceed payment amount'
        using errcode = '22023';
    end if;
  end loop;

  perform private.recompute_payment_allocation_status(p_org_id, p_payment_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------------

create or replace function public.get_payment(
  p_payment_id uuid,
  p_org_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not private.has_org_role(
    p_org_id,
    array['owner', 'admin', 'member', 'billing', 'readonly']
  ) then
    raise exception 'This action is not permitted' using errcode = '42501';
  end if;

  return private.payment_document(p_payment_id, p_org_id);
end;
$$;

revoke all on function public.get_payment(uuid, uuid) from public, anon;
grant execute on function public.get_payment(uuid, uuid) to authenticated;

create or replace function public.create_payment(
  p_org_id uuid,
  p_payload jsonb,
  p_allocations jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
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
  if v_actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted' using errcode = '42501';
  end if;
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

revoke all on function public.create_payment(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.create_payment(uuid, jsonb, jsonb) to authenticated;

create or replace function public.allocate_payment(
  p_payment_id uuid,
  p_org_id uuid,
  p_expected_version integer,
  p_allocations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  payment_row public.payments;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted' using errcode = '42501';
  end if;

  select * into payment_row
  from public.payments
  where id = p_payment_id and org_id = p_org_id
  for update;

  if not found then
    raise exception 'Payment not found' using errcode = 'P0002';
  end if;
  if payment_row.version is distinct from p_expected_version then
    raise exception 'Payment version conflict' using errcode = 'P0001';
  end if;

  if p_allocations is null
    or jsonb_typeof(p_allocations) <> 'array'
    or jsonb_array_length(p_allocations) < 1
  then
    raise exception 'allocations must be a non-empty array' using errcode = '22023';
  end if;

  perform private.apply_payment_allocations(
    p_org_id, p_payment_id, p_allocations, v_actor_id
  );

  -- Bump payment version for ETag after mutation side-effects.
  update public.payments
  set updated_by = v_actor_id
  where id = p_payment_id and org_id = p_org_id;

  return private.payment_document(p_payment_id, p_org_id);
end;
$$;

revoke all on function public.allocate_payment(uuid, uuid, integer, jsonb)
  from public, anon;
grant execute on function public.allocate_payment(uuid, uuid, integer, jsonb)
  to authenticated;

create or replace function public.reverse_payment(
  p_payment_id uuid,
  p_org_id uuid,
  p_expected_version integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  payment_row public.payments;
  reversing_row public.payments;
  reason text := nullif(trim(coalesce(p_reason, '')), '');
  invoice_ids uuid[];
  bill_ids uuid[];
  i integer;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted' using errcode = '42501';
  end if;
  if reason is null or char_length(reason) > 2000 then
    raise exception 'reversal reason is required (max 2000 chars)' using errcode = '22023';
  end if;

  select * into payment_row
  from public.payments
  where id = p_payment_id and org_id = p_org_id
  for update;

  if not found then
    raise exception 'Payment not found' using errcode = 'P0002';
  end if;
  if payment_row.version is distinct from p_expected_version then
    raise exception 'Payment version conflict' using errcode = 'P0001';
  end if;
  if payment_row.status = 'reversed' or payment_row.reverses_payment_id is not null then
    raise exception 'Payment is already reversed or is a reversing entry'
      using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct invoice_id) filter (where invoice_id is not null), array[]::uuid[]),
         coalesce(array_agg(distinct bill_id) filter (where bill_id is not null), array[]::uuid[])
  into invoice_ids, bill_ids
  from public.payment_allocations
  where payment_id = p_payment_id
    and org_id = p_org_id
    and reversed_at is null;

  update public.payment_allocations
  set
    reversed_at = now(),
    reversal_reason = reason,
    updated_by = v_actor_id
  where payment_id = p_payment_id
    and org_id = p_org_id
    and reversed_at is null;

  insert into public.payments (
    org_id, direction, client_id, vendor_id, amount_cents, currency, method,
    status, occurred_on, reference, provider, provider_payment_id, notes,
    reverses_payment_id, completed_at, metadata, created_by, updated_by
  ) values (
    p_org_id,
    payment_row.direction,
    payment_row.client_id,
    payment_row.vendor_id,
    payment_row.amount_cents,
    payment_row.currency,
    payment_row.method,
    'completed',
    (timezone('utc', now()))::date,
    payment_row.reference,
    payment_row.provider,
    null,
    'Reversal of payment ' || payment_row.id::text || ': ' || reason,
    payment_row.id,
    now(),
    jsonb_build_object('reversal_of', payment_row.id, 'reason', reason),
    v_actor_id,
    v_actor_id
  )
  returning * into reversing_row;

  update public.payments
  set
    status = 'reversed',
    updated_by = v_actor_id
  where id = payment_row.id and org_id = p_org_id;

  if cardinality(invoice_ids) > 0 then
    for i in 1 .. cardinality(invoice_ids) loop
      perform private.recompute_invoice_payment_state(p_org_id, invoice_ids[i]);
    end loop;
  end if;

  if cardinality(bill_ids) > 0 then
    for i in 1 .. cardinality(bill_ids) loop
      perform private.recompute_bill_payment_state(p_org_id, bill_ids[i]);
    end loop;
  end if;

  return jsonb_build_object(
    'payment', private.payment_document(payment_row.id, p_org_id) -> 'payment',
    'allocations', private.payment_document(payment_row.id, p_org_id) -> 'allocations',
    'reversing_payment', to_jsonb(reversing_row)
  );
end;
$$;

revoke all on function public.reverse_payment(uuid, uuid, integer, text)
  from public, anon;
grant execute on function public.reverse_payment(uuid, uuid, integer, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Idempotent wrappers (replay before version check; omit version from hash)
-- ---------------------------------------------------------------------------

create or replace function public.create_payment_idempotent(
  p_org_id uuid,
  p_payload jsonb,
  p_allocations jsonb,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_route text,
  p_ttl_seconds integer default 86400
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_existing public.api_idempotency_keys;
  v_expires_at timestamptz := now() + make_interval(secs => greatest(coalesce(p_ttl_seconds, 86400), 60));
  doc jsonb;
  payment_id uuid;
  v_response_headers jsonb;
  v_response_body jsonb;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
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
  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted' using errcode = '42501';
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

  doc := public.create_payment(p_org_id, p_payload, coalesce(p_allocations, '[]'::jsonb));
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
  uuid, jsonb, jsonb, text, text, text, integer
) from public, anon;
grant execute on function public.create_payment_idempotent(
  uuid, jsonb, jsonb, text, text, text, integer
) to authenticated;

create or replace function public.allocate_payment_idempotent(
  p_payment_id uuid,
  p_org_id uuid,
  p_expected_version integer,
  p_allocations jsonb,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_route text,
  p_ttl_seconds integer default 86400
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_existing public.api_idempotency_keys;
  v_expires_at timestamptz := now() + make_interval(secs => greatest(coalesce(p_ttl_seconds, 86400), 60));
  doc jsonb;
  v_response_headers jsonb;
  v_response_body jsonb;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
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
  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted' using errcode = '42501';
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

  doc := public.allocate_payment(
    p_payment_id, p_org_id, p_expected_version, p_allocations
  );

  v_response_headers := jsonb_build_object(
    'etag', '"' || (doc -> 'payment' ->> 'version') || '"'
  );
  v_response_body := jsonb_build_object(
    'status', 200,
    'body', jsonb_build_object(
      'data', (doc -> 'payment') || jsonb_build_object('allocations', doc -> 'allocations')
    ),
    'headers', v_response_headers
  );

  update public.api_idempotency_keys
  set
    response_status = 200,
    response_body = v_response_body,
    resource_type = 'payment',
    resource_id = p_payment_id
  where api_idempotency_keys.org_id = p_org_id
    and api_idempotency_keys.actor_type = 'user'
    and api_idempotency_keys.actor_id = v_actor_id
    and api_idempotency_keys.idempotency_key_hash = p_idempotency_key_hash;

  return jsonb_build_object(
    'replay', false,
    'response_status', 200,
    'response_body', v_response_body -> 'body',
    'response_headers', v_response_headers
  );
end;
$$;

revoke all on function public.allocate_payment_idempotent(
  uuid, uuid, integer, jsonb, text, text, text, integer
) from public, anon;
grant execute on function public.allocate_payment_idempotent(
  uuid, uuid, integer, jsonb, text, text, text, integer
) to authenticated;

create or replace function public.reverse_payment_idempotent(
  p_payment_id uuid,
  p_org_id uuid,
  p_expected_version integer,
  p_reason text,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_route text,
  p_ttl_seconds integer default 86400
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_existing public.api_idempotency_keys;
  v_expires_at timestamptz := now() + make_interval(secs => greatest(coalesce(p_ttl_seconds, 86400), 60));
  doc jsonb;
  v_response_headers jsonb;
  v_response_body jsonb;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
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
  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted' using errcode = '42501';
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

  doc := public.reverse_payment(
    p_payment_id, p_org_id, p_expected_version, p_reason
  );

  v_response_headers := jsonb_build_object(
    'etag', '"' || (doc -> 'payment' ->> 'version') || '"'
  );
  v_response_body := jsonb_build_object(
    'status', 200,
    'body', jsonb_build_object(
      'data',
      (doc -> 'payment')
        || jsonb_build_object('allocations', doc -> 'allocations')
        || case
          when doc ? 'reversing_payment' then
            jsonb_build_object('reversing_payment', doc -> 'reversing_payment')
          else '{}'::jsonb
        end
    ),
    'headers', v_response_headers
  );

  update public.api_idempotency_keys
  set
    response_status = 200,
    response_body = v_response_body,
    resource_type = 'payment',
    resource_id = p_payment_id
  where api_idempotency_keys.org_id = p_org_id
    and api_idempotency_keys.actor_type = 'user'
    and api_idempotency_keys.actor_id = v_actor_id
    and api_idempotency_keys.idempotency_key_hash = p_idempotency_key_hash;

  return jsonb_build_object(
    'replay', false,
    'response_status', 200,
    'response_body', v_response_body -> 'body',
    'response_headers', v_response_headers
  );
end;
$$;

revoke all on function public.reverse_payment_idempotent(
  uuid, uuid, integer, text, text, text, text, integer
) from public, anon;
grant execute on function public.reverse_payment_idempotent(
  uuid, uuid, integer, text, text, text, text, integer
) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS + grants (member SELECT; mutations via security-definer RPCs only)
-- ---------------------------------------------------------------------------

alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;

create policy payments_select_member
on public.payments
for select
to authenticated
using (
  private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'billing', 'readonly']
  )
);

create policy payment_allocations_select_member
on public.payment_allocations
for select
to authenticated
using (
  private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'billing', 'readonly']
  )
);

revoke all on table public.payments from public, anon, authenticated;
revoke all on table public.payment_allocations from public, anon, authenticated;

grant select on table public.payments to authenticated;
grant select on table public.payment_allocations to authenticated;

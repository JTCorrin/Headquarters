-- Bills / payables foundation: vendors, bills, bill_lines, draft RPCs, and
-- draft → received → void lifecycle. Payment allocations and scheduled/partial/paid
-- transitions are deferred (see PLANS/BILLS_PAYABLES_FOUNDATION_SLICE.md).

set search_path = public, extensions, pg_catalog;

-- ---------------------------------------------------------------------------
-- vendors
-- ---------------------------------------------------------------------------

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  name text not null check (char_length(name) between 1 and 200),
  status text not null default 'active',
  primary_email citext,
  phone text,
  website_url text,
  tax_identifier text,
  default_currency char(3),
  payment_terms_days smallint check (
    payment_terms_days is null
    or (payment_terms_days >= 0 and payment_terms_days <= 3650)
  ),
  bank_details_encrypted text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  constraint vendors_org_id_id_key unique (org_id, id),
  constraint vendors_status_check
    check (status in ('active', 'inactive', 'archived')),
  constraint vendors_currency_format_check
    check (default_currency is null or default_currency ~ '^[A-Z]{3}$'),
  constraint vendors_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create index vendors_org_created_idx
  on public.vendors (org_id, created_at desc, id desc)
  where deleted_at is null;

create index vendors_org_name_idx
  on public.vendors (org_id, lower(name))
  where deleted_at is null;

create trigger vendors_stamp_business_row
before insert or update on public.vendors
for each row execute function private.stamp_business_row();

create or replace function public.soft_delete_vendor(
  p_vendor_id uuid,
  p_org_id uuid,
  p_expected_version integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  vendor_row public.vendors;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into vendor_row
  from public.vendors
  where vendors.id = p_vendor_id
    and vendors.org_id = p_org_id
    and vendors.deleted_at is null
  for update;

  if not found then
    raise exception 'Vendor not found'
      using errcode = 'P0002';
  end if;

  if vendor_row.version is distinct from p_expected_version then
    raise exception 'Vendor version conflict'
      using errcode = 'P0001';
  end if;

  update public.vendors
  set
    deleted_at = now(),
    updated_by = actor_id
  where vendors.id = vendor_row.id;
end;
$$;

revoke all on function public.soft_delete_vendor(uuid, uuid, integer)
  from public, anon;
grant execute on function public.soft_delete_vendor(uuid, uuid, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- bills / bill_lines
-- ---------------------------------------------------------------------------

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  vendor_id uuid not null,
  number text not null check (char_length(number) between 1 and 64),
  internal_reference text check (
    internal_reference is null or char_length(internal_reference) between 1 and 64
  ),
  status text not null default 'draft',
  currency char(3) not null,
  issue_on date,
  received_on date,
  due_on date not null,
  scheduled_payment_on date,
  subtotal_cents bigint not null default 0 check (subtotal_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  paid_cents bigint not null default 0 check (paid_cents >= 0),
  balance_due_cents bigint not null default 0 check (balance_due_cents >= 0),
  party_snapshot jsonb not null default '{}'::jsonb,
  notes text,
  attachment_document_id uuid,
  paid_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  constraint bills_org_id_id_key unique (org_id, id),
  constraint bills_vendor_fk
    foreign key (org_id, vendor_id)
    references public.vendors (org_id, id)
    on delete restrict,
  constraint bills_attachment_document_fk
    foreign key (org_id, attachment_document_id)
    references public.documents (org_id, id)
    on delete set null (attachment_document_id),
  constraint bills_status_check
    check (status in ('draft', 'received', 'scheduled', 'partial', 'paid', 'void')),
  constraint bills_currency_format_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint bills_discount_lte_subtotal_check
    check (discount_cents <= subtotal_cents),
  constraint bills_paid_lte_total_check
    check (paid_cents <= total_cents),
  constraint bills_party_snapshot_object_check
    check (jsonb_typeof(party_snapshot) = 'object'),
  constraint bills_due_on_issue_check
    check (issue_on is null or due_on >= issue_on),
  constraint bills_received_requires_date_check
    check (status = 'draft' or status = 'void' or received_on is not null),
  constraint bills_void_reason_required_check
    check (status <> 'void' or void_reason is not null)
);

create unique index bills_org_vendor_number_uidx
  on public.bills (org_id, vendor_id, number)
  where deleted_at is null;

create unique index bills_org_internal_reference_uidx
  on public.bills (org_id, internal_reference)
  where deleted_at is null and internal_reference is not null;

create index bills_org_created_idx
  on public.bills (org_id, created_at desc, id desc)
  where deleted_at is null;

create index bills_org_status_due_idx
  on public.bills (org_id, status, due_on desc)
  where deleted_at is null;

create index bills_org_vendor_idx
  on public.bills (org_id, vendor_id)
  where deleted_at is null;

create trigger bills_stamp_business_row
before insert or update on public.bills
for each row execute function private.stamp_business_row();

create table public.bill_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  version integer not null default 1 check (version > 0),
  bill_id uuid not null,
  product_id uuid,
  sku_snapshot text,
  description text not null check (char_length(description) between 1 and 200),
  quantity numeric(14, 4) not null,
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  discount_percent numeric(7, 4) not null default 0,
  tax_rate_percent numeric(7, 4) not null default 0,
  subtotal_cents bigint not null check (subtotal_cents >= 0),
  tax_cents bigint not null check (tax_cents >= 0),
  total_cents bigint not null check (total_cents >= 0),
  position integer not null check (position >= 0),
  constraint bill_lines_org_id_id_key unique (org_id, id),
  constraint bill_lines_bill_fk
    foreign key (org_id, bill_id)
    references public.bills (org_id, id)
    on delete cascade,
  constraint bill_lines_product_fk
    foreign key (org_id, product_id)
    references public.products (org_id, id)
    on delete restrict,
  constraint bill_lines_quantity_check
    check (
      lower(quantity::text) not in ('nan', 'infinity', '-infinity')
      and quantity > 0
    ),
  constraint bill_lines_discount_percent_check
    check (
      lower(discount_percent::text) not in ('nan', 'infinity', '-infinity')
      and discount_percent >= 0
      and discount_percent <= 100
    ),
  constraint bill_lines_tax_rate_percent_check
    check (
      lower(tax_rate_percent::text) not in ('nan', 'infinity', '-infinity')
      and tax_rate_percent >= 0
      and tax_rate_percent <= 100
    )
);

create unique index bill_lines_bill_position_uidx
  on public.bill_lines (bill_id, position);

create index bill_lines_org_bill_idx
  on public.bill_lines (org_id, bill_id, position);

create trigger bill_lines_stamp_business_row
before insert or update on public.bill_lines
for each row execute function private.stamp_business_row();

-- ---------------------------------------------------------------------------
-- Validation / protection triggers
-- ---------------------------------------------------------------------------

create or replace function private.validate_bill_party_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and new.deleted_at is not null
    and old.deleted_at is null
  then
    return new;
  end if;

  if new.vendor_id is not null
    and (
      tg_op = 'INSERT'
      or new.vendor_id is distinct from old.vendor_id
    )
    and not exists (
      select 1
      from public.vendors
      where vendors.id = new.vendor_id
        and vendors.org_id = new.org_id
        and vendors.deleted_at is null
    )
  then
    raise exception 'Bill vendor must be an active vendor in the same organisation'
      using errcode = '22023';
  end if;

  if new.attachment_document_id is not null
    and (
      tg_op = 'INSERT'
      or new.attachment_document_id is distinct from old.attachment_document_id
    )
    and not exists (
      select 1
      from public.documents
      where documents.id = new.attachment_document_id
        and documents.org_id = new.org_id
        and documents.deleted_at is null
    )
  then
    raise exception 'Bill attachment must belong to the same organisation'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger bills_validate_party_refs
before insert or update on public.bills
for each row execute function private.validate_bill_party_refs();

create or replace function private.protect_bill_draft_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.deleted_at is not null then
      raise exception 'Soft-deleted bills cannot be updated'
        using errcode = '22023';
    end if;

    if old.status <> 'draft'
      and current_setting('app.allow_bill_lifecycle', true) is distinct from 'on'
    then
      raise exception 'Only draft bills can be edited in this release'
        using errcode = '22023';
    end if;

    if current_setting('app.allow_bill_totals', true) is distinct from 'on'
      and current_setting('app.allow_bill_lifecycle', true) is distinct from 'on'
      and (
        new.subtotal_cents is distinct from old.subtotal_cents
        or new.discount_cents is distinct from old.discount_cents
        or new.tax_cents is distinct from old.tax_cents
        or new.total_cents is distinct from old.total_cents
        or new.paid_cents is distinct from old.paid_cents
        or new.balance_due_cents is distinct from old.balance_due_cents
        or new.status is distinct from old.status
        or new.party_snapshot is distinct from old.party_snapshot
        or new.received_on is distinct from old.received_on
        or new.paid_at is distinct from old.paid_at
        or new.voided_at is distinct from old.voided_at
        or new.void_reason is distinct from old.void_reason
      )
    then
      raise exception 'Calculated or lifecycle bill fields are not writable'
        using errcode = '22023';
    end if;
  end if;

  if tg_op = 'INSERT'
    and current_setting('app.allow_bill_totals', true) is distinct from 'on'
    and current_setting('app.allow_bill_lifecycle', true) is distinct from 'on'
  then
    raise exception 'Bills must be created through the draft RPC'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger bills_protect_draft_columns
before insert or update on public.bills
for each row execute function private.protect_bill_draft_columns();

create or replace function private.protect_bill_line_direct_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.allow_bill_totals', true) is distinct from 'on' then
    raise exception 'Bill lines must be written through the draft RPC'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger bill_lines_protect_direct_writes
before insert or update or delete on public.bill_lines
for each row execute function private.protect_bill_line_direct_writes();

create or replace function private.replace_bill_lines(
  p_org_id uuid,
  p_bill_id uuid,
  p_actor_id uuid,
  p_lines jsonb,
  p_bill_currency char(3)
)
returns table (
  subtotal_cents bigint,
  tax_cents bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  line_item jsonb;
  line_index integer := 0;
  product_row public.products;
  tax_row public.tax_rates;
  line_product_id uuid;
  line_description text;
  line_sku text;
  line_quantity numeric(14, 4);
  line_unit_price bigint;
  line_discount numeric(7, 4);
  line_tax_rate numeric(7, 4);
  line_position integer;
  amounts record;
  header_subtotal bigint := 0;
  header_tax bigint := 0;
  json_safe_max bigint := 9007199254740991; -- Number.MAX_SAFE_INTEGER
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Bill lines must be an array'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_lines) > 200 then
    raise exception 'Bill cannot exceed 200 lines'
      using errcode = '22023';
  end if;

  if p_bill_currency is null or p_bill_currency !~ '^[A-Z]{3}$' then
    raise exception 'Bill currency must be a 3-letter ISO code'
      using errcode = '22023';
  end if;

  delete from public.bill_lines
  where bill_lines.bill_id = p_bill_id
    and bill_lines.org_id = p_org_id;

  for line_item in
    select value
    from jsonb_array_elements(p_lines) with ordinality as t(value, ord)
    order by ord
  loop
    line_product_id := nullif(line_item ->> 'product_id', '')::uuid;
    line_description := nullif(trim(coalesce(line_item ->> 'description', '')), '');
    line_sku := null;
    line_quantity := (line_item ->> 'quantity')::numeric;
    line_discount := coalesce((line_item ->> 'discount_percent')::numeric, 0);
    line_position := coalesce((line_item ->> 'position')::integer, line_index);

    if line_quantity is null
      or lower(line_quantity::text) in ('nan', 'infinity', '-infinity')
      or line_quantity <= 0
    then
      raise exception 'Bill line quantity must be greater than zero'
        using errcode = '22023';
    end if;

    if line_discount < 0 or line_discount > 100
      or lower(line_discount::text) in ('nan', 'infinity', '-infinity')
    then
      raise exception 'Bill line discount_percent must be between 0 and 100'
        using errcode = '22023';
    end if;

    if line_position < 0 then
      raise exception 'Bill line position must be non-negative'
        using errcode = '22023';
    end if;

    if line_product_id is not null then
      select * into product_row
      from public.products
      where products.id = line_product_id
        and products.org_id = p_org_id
        and products.deleted_at is null
        and products.status = 'active'
      for share;

      if not found then
        raise exception 'Bill line product must be an active product in the same organisation'
          using errcode = '22023';
      end if;

      if product_row.currency is distinct from p_bill_currency then
        raise exception 'Bill line product currency must match bill currency'
          using errcode = '22023';
      end if;

      -- Product SKU snapshot is server-owned; ignore client-supplied sku_snapshot.
      line_sku := product_row.sku;
      line_description := coalesce(line_description, product_row.name);
      line_unit_price := coalesce(
        nullif(line_item ->> 'unit_price_cents', '')::bigint,
        product_row.unit_price_cents
      );

      if line_item ? 'tax_rate_percent' and line_item ->> 'tax_rate_percent' is not null then
        line_tax_rate := (line_item ->> 'tax_rate_percent')::numeric;
      elsif product_row.tax_rate_id is not null then
        select * into tax_row
        from public.tax_rates
        where tax_rates.id = product_row.tax_rate_id
          and tax_rates.org_id = p_org_id
          and tax_rates.deleted_at is null
          and tax_rates.active;

        if found then
          line_tax_rate := tax_row.rate_percent;
        else
          line_tax_rate := 0;
        end if;
      else
        line_tax_rate := 0;
      end if;
    else
      if line_item ->> 'unit_price_cents' is null then
        raise exception 'Free-text bill lines require unit_price_cents'
          using errcode = '22023';
      end if;
      line_unit_price := (line_item ->> 'unit_price_cents')::bigint;
      line_tax_rate := coalesce((line_item ->> 'tax_rate_percent')::numeric, 0);
    end if;

    if line_description is null or char_length(line_description) > 200 then
      raise exception 'Bill line description must be between 1 and 200 characters'
        using errcode = '22023';
    end if;

    if line_unit_price is null or line_unit_price < 0 then
      raise exception 'Bill line unit_price_cents must be a non-negative integer'
        using errcode = '22023';
    end if;

    if line_tax_rate < 0 or line_tax_rate > 100
      or lower(line_tax_rate::text) in ('nan', 'infinity', '-infinity')
    then
      raise exception 'Bill line tax_rate_percent must be between 0 and 100'
        using errcode = '22023';
    end if;

    if line_unit_price > 0
      and line_quantity > (json_safe_max::numeric / line_unit_price::numeric)
    then
      raise exception 'Bill line totals exceed JSON-safe integer range'
        using errcode = '22023';
    end if;

    select * into amounts
    from private.calculate_quote_line_amounts(
      line_quantity,
      line_unit_price,
      line_discount,
      line_tax_rate
    );

    if amounts.subtotal_cents > json_safe_max
      or amounts.tax_cents > json_safe_max
      or amounts.total_cents > json_safe_max
    then
      raise exception 'Bill line totals exceed JSON-safe integer range'
        using errcode = '22023';
    end if;

    if header_subtotal > json_safe_max - amounts.subtotal_cents
      or header_tax > json_safe_max - amounts.tax_cents
    then
      raise exception 'Bill totals exceed JSON-safe integer range'
        using errcode = '22023';
    end if;

    insert into public.bill_lines (
      org_id,
      bill_id,
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
    values (
      p_org_id,
      p_bill_id,
      line_product_id,
      line_sku,
      line_description,
      line_quantity,
      line_unit_price,
      line_discount,
      line_tax_rate,
      amounts.subtotal_cents,
      amounts.tax_cents,
      amounts.total_cents,
      line_position,
      p_actor_id,
      p_actor_id
    );

    header_subtotal := header_subtotal + amounts.subtotal_cents;
    header_tax := header_tax + amounts.tax_cents;
    line_index := line_index + 1;
  end loop;

  return query select header_subtotal, header_tax;
end;
$$;

revoke all on function private.replace_bill_lines(uuid, uuid, uuid, jsonb, char)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- Draft RPCs + receive/void lifecycle
-- ---------------------------------------------------------------------------

create or replace function public.create_bill_draft(
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
  bill_row public.bills;
  vendor_row public.vendors;
  org_currency char(3);
  currency text;
  issue_on date;
  due_on date;
  received_on date;
  scheduled_payment_on date;
  v_discount_cents bigint;
  vendor_id uuid;
  bill_number text;
  internal_reference text;
  notes text;
  attachment_document_id uuid;
  lines_json jsonb;
  line_totals record;
  party_snapshot jsonb;
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
    raise exception 'Bill payload must be an object'
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

  vendor_id := nullif(p_payload ->> 'vendor_id', '')::uuid;
  if vendor_id is null then
    raise exception 'Bill requires vendor_id'
      using errcode = '22023';
  end if;

  select * into vendor_row
  from public.vendors
  where vendors.id = vendor_id
    and vendors.org_id = p_org_id
    and vendors.deleted_at is null;

  if not found then
    raise exception 'Bill vendor must be an active vendor in the same organisation'
      using errcode = '22023';
  end if;

  bill_number := nullif(trim(coalesce(p_payload ->> 'number', '')), '');
  if bill_number is null or char_length(bill_number) > 64 then
    raise exception 'Bill number must be between 1 and 64 characters'
      using errcode = '22023';
  end if;

  internal_reference := nullif(trim(coalesce(p_payload ->> 'internal_reference', '')), '');
  if internal_reference is not null and char_length(internal_reference) > 64 then
    raise exception 'Bill internal_reference must be at most 64 characters'
      using errcode = '22023';
  end if;

  currency := upper(coalesce(nullif(trim(p_payload ->> 'currency'), ''), org_currency));
  if currency !~ '^[A-Z]{3}$' then
    raise exception 'Bill currency must be a 3-letter ISO code'
      using errcode = '22023';
  end if;

  issue_on := (p_payload ->> 'issue_on')::date;
  due_on := coalesce((p_payload ->> 'due_on')::date, coalesce(issue_on, (timezone('utc', now()))::date) + 30);
  received_on := (p_payload ->> 'received_on')::date;
  scheduled_payment_on := (p_payload ->> 'scheduled_payment_on')::date;

  if issue_on is not null and due_on < issue_on then
    raise exception 'Bill due_on cannot be before issue_on'
      using errcode = '22023';
  end if;

  v_discount_cents := coalesce((p_payload ->> 'discount_cents')::bigint, 0);
  if v_discount_cents < 0 then
    raise exception 'Bill discount_cents must be non-negative'
      using errcode = '22023';
  end if;

  notes := nullif(trim(coalesce(p_payload ->> 'notes', '')), '');
  attachment_document_id := nullif(p_payload ->> 'attachment_document_id', '')::uuid;

  party_snapshot := jsonb_build_object(
    'vendor', jsonb_build_object(
      'id', vendor_row.id,
      'name', vendor_row.name,
      'primary_email', vendor_row.primary_email,
      'phone', vendor_row.phone,
      'tax_identifier', vendor_row.tax_identifier,
      'default_currency', vendor_row.default_currency,
      'payment_terms_days', vendor_row.payment_terms_days
    )
  );

  perform set_config('app.allow_bill_totals', 'on', true);

  insert into public.bills (
    org_id,
    vendor_id,
    number,
    internal_reference,
    status,
    currency,
    issue_on,
    received_on,
    due_on,
    scheduled_payment_on,
    subtotal_cents,
    discount_cents,
    tax_cents,
    total_cents,
    paid_cents,
    balance_due_cents,
    party_snapshot,
    notes,
    attachment_document_id,
    created_by,
    updated_by
  )
  values (
    p_org_id,
    vendor_id,
    bill_number,
    internal_reference,
    'draft',
    currency,
    issue_on,
    received_on,
    due_on,
    scheduled_payment_on,
    0,
    0,
    0,
    0,
    0,
    0,
    party_snapshot,
    notes,
    attachment_document_id,
    actor_id,
    actor_id
  )
  returning * into bill_row;

  select * into line_totals
  from private.replace_bill_lines(
    p_org_id,
    bill_row.id,
    actor_id,
    coalesce(p_lines, '[]'::jsonb),
    currency::char(3)
  );

  if v_discount_cents > line_totals.subtotal_cents then
    raise exception 'Bill discount_cents cannot exceed subtotal_cents'
      using errcode = '23514';
  end if;

  perform private.assert_json_safe_cents(
    line_totals.subtotal_cents - v_discount_cents + line_totals.tax_cents,
    'Bill total_cents'
  );

  update public.bills
  set
    discount_cents = v_discount_cents,
    subtotal_cents = line_totals.subtotal_cents,
    tax_cents = line_totals.tax_cents,
    total_cents = line_totals.subtotal_cents - v_discount_cents + line_totals.tax_cents,
    balance_due_cents = line_totals.subtotal_cents - v_discount_cents + line_totals.tax_cents,
    updated_by = actor_id
  where bills.id = bill_row.id
  returning * into bill_row;

  select coalesce(
    jsonb_agg(to_jsonb(bill_lines) order by bill_lines.position, bill_lines.id),
    '[]'::jsonb
  )
  into lines_json
  from public.bill_lines
  where bill_lines.bill_id = bill_row.id;

  perform set_config('app.allow_bill_totals', 'off', true);

  return jsonb_build_object(
    'bill', to_jsonb(bill_row),
    'lines', lines_json
  );
end;
$$;

create or replace function public.save_bill_draft(
  p_bill_id uuid,
  p_org_id uuid,
  p_expected_version integer,
  p_payload jsonb,
  p_lines jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  bill_row public.bills;
  vendor_row public.vendors;
  lines_json jsonb;
  next_vendor_id uuid;
  next_number text;
  next_internal_reference text;
  next_currency char(3);
  next_issue_on date;
  next_due_on date;
  next_received_on date;
  next_scheduled_payment_on date;
  next_discount_cents bigint;
  next_notes text;
  next_attachment_document_id uuid;
  next_party_snapshot jsonb;
  line_totals record;
  next_subtotal bigint;
  next_tax bigint;
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
    raise exception 'Bill payload must be an object'
      using errcode = '22023';
  end if;

  select * into bill_row
  from public.bills
  where bills.id = p_bill_id
    and bills.org_id = p_org_id
    and bills.deleted_at is null
  for update;

  if not found then
    raise exception 'Bill not found'
      using errcode = 'P0002';
  end if;

  if bill_row.version is distinct from p_expected_version then
    raise exception 'Bill version conflict'
      using errcode = 'P0001';
  end if;

  if bill_row.status <> 'draft' then
    raise exception 'Only draft bills can be edited in this release'
      using errcode = '22023';
  end if;

  next_vendor_id := coalesce(nullif(p_payload ->> 'vendor_id', '')::uuid, bill_row.vendor_id);
  next_number := coalesce(nullif(trim(coalesce(p_payload ->> 'number', '')), ''), bill_row.number);
  if char_length(next_number) > 64 then
    raise exception 'Bill number must be between 1 and 64 characters'
      using errcode = '22023';
  end if;

  if p_payload ? 'internal_reference' then
    next_internal_reference := nullif(trim(coalesce(p_payload ->> 'internal_reference', '')), '');
  else
    next_internal_reference := bill_row.internal_reference;
  end if;

  next_currency := upper(coalesce(nullif(trim(p_payload ->> 'currency'), ''), bill_row.currency));
  if next_currency !~ '^[A-Z]{3}$' then
    raise exception 'Bill currency must be a 3-letter ISO code'
      using errcode = '22023';
  end if;

  if p_payload ? 'issue_on' then
    next_issue_on := nullif(p_payload ->> 'issue_on', '')::date;
  else
    next_issue_on := bill_row.issue_on;
  end if;

  next_due_on := coalesce((p_payload ->> 'due_on')::date, bill_row.due_on);

  if p_payload ? 'received_on' then
    next_received_on := nullif(p_payload ->> 'received_on', '')::date;
  else
    next_received_on := bill_row.received_on;
  end if;

  if p_payload ? 'scheduled_payment_on' then
    next_scheduled_payment_on := nullif(p_payload ->> 'scheduled_payment_on', '')::date;
  else
    next_scheduled_payment_on := bill_row.scheduled_payment_on;
  end if;

  if next_issue_on is not null and next_due_on < next_issue_on then
    raise exception 'Bill due_on cannot be before issue_on'
      using errcode = '22023';
  end if;

  next_discount_cents := coalesce((p_payload ->> 'discount_cents')::bigint, bill_row.discount_cents);
  if next_discount_cents < 0 then
    raise exception 'Bill discount_cents must be non-negative'
      using errcode = '22023';
  end if;

  if p_payload ? 'notes' then
    next_notes := nullif(trim(coalesce(p_payload ->> 'notes', '')), '');
  else
    next_notes := bill_row.notes;
  end if;

  if p_payload ? 'attachment_document_id' then
    next_attachment_document_id := nullif(p_payload ->> 'attachment_document_id', '')::uuid;
  else
    next_attachment_document_id := bill_row.attachment_document_id;
  end if;

  next_party_snapshot := bill_row.party_snapshot;
  if next_vendor_id is distinct from bill_row.vendor_id
    or not (bill_row.party_snapshot ? 'vendor')
  then
    select * into vendor_row
    from public.vendors
    where vendors.id = next_vendor_id
      and vendors.org_id = p_org_id
      and vendors.deleted_at is null;

    if not found then
      raise exception 'Bill vendor must be an active vendor in the same organisation'
        using errcode = '22023';
    end if;

    next_party_snapshot := jsonb_build_object(
      'vendor', jsonb_build_object(
        'id', vendor_row.id,
        'name', vendor_row.name,
        'primary_email', vendor_row.primary_email,
        'phone', vendor_row.phone,
        'tax_identifier', vendor_row.tax_identifier,
        'default_currency', vendor_row.default_currency,
        'payment_terms_days', vendor_row.payment_terms_days
      )
    );
  end if;

  perform set_config('app.allow_bill_totals', 'on', true);

  if p_lines is not null then
    select * into line_totals
    from private.replace_bill_lines(
      p_org_id,
      bill_row.id,
      actor_id,
      p_lines,
      next_currency
    );
    next_subtotal := line_totals.subtotal_cents;
    next_tax := line_totals.tax_cents;
  else
    select
      coalesce(sum(bill_lines.subtotal_cents), 0),
      coalesce(sum(bill_lines.tax_cents), 0)
    into next_subtotal, next_tax
    from public.bill_lines
    where bill_lines.bill_id = bill_row.id;
  end if;

  if next_discount_cents > next_subtotal then
    raise exception 'Bill discount_cents cannot exceed subtotal_cents'
      using errcode = '23514';
  end if;

  perform private.assert_json_safe_cents(
    next_subtotal - next_discount_cents + next_tax,
    'Bill total_cents'
  );

  update public.bills
  set
    vendor_id = next_vendor_id,
    number = next_number,
    internal_reference = next_internal_reference,
    currency = next_currency,
    issue_on = next_issue_on,
    received_on = next_received_on,
    due_on = next_due_on,
    scheduled_payment_on = next_scheduled_payment_on,
    discount_cents = next_discount_cents,
    subtotal_cents = next_subtotal,
    tax_cents = next_tax,
    total_cents = next_subtotal - next_discount_cents + next_tax,
    balance_due_cents = next_subtotal - next_discount_cents + next_tax,
    party_snapshot = next_party_snapshot,
    notes = next_notes,
    attachment_document_id = next_attachment_document_id,
    updated_by = actor_id
  where bills.id = bill_row.id
  returning * into bill_row;

  select coalesce(
    jsonb_agg(to_jsonb(bill_lines) order by bill_lines.position, bill_lines.id),
    '[]'::jsonb
  )
  into lines_json
  from public.bill_lines
  where bill_lines.bill_id = bill_row.id;

  perform set_config('app.allow_bill_totals', 'off', true);

  return jsonb_build_object(
    'bill', to_jsonb(bill_row),
    'lines', lines_json
  );
end;
$$;

create or replace function public.get_bill_document(
  p_bill_id uuid,
  p_org_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  bill_row public.bills;
  lines_json jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(
    p_org_id,
    array['owner', 'admin', 'member', 'billing', 'readonly']
  ) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into bill_row
  from public.bills
  where bills.id = p_bill_id
    and bills.org_id = p_org_id
    and bills.deleted_at is null
  for share;

  if not found then
    raise exception 'Bill not found'
      using errcode = 'P0002';
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(bill_lines) order by bill_lines.position, bill_lines.id),
    '[]'::jsonb
  )
  into lines_json
  from public.bill_lines
  where bill_lines.bill_id = bill_row.id;

  return jsonb_build_object(
    'bill', to_jsonb(bill_row),
    'lines', lines_json
  );
end;
$$;

create or replace function public.soft_delete_bill_draft(
  p_bill_id uuid,
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
  bill_row public.bills;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into bill_row
  from public.bills
  where bills.id = p_bill_id
    and bills.org_id = p_org_id
    and bills.deleted_at is null
  for update;

  if not found then
    raise exception 'Bill not found'
      using errcode = 'P0002';
  end if;

  if bill_row.version is distinct from p_expected_version then
    raise exception 'Bill version conflict'
      using errcode = 'P0001';
  end if;

  if bill_row.status <> 'draft' then
    raise exception 'Only draft bills can be deleted'
      using errcode = '22023';
  end if;

  perform set_config('app.allow_bill_lifecycle', 'on', true);

  update public.bills
  set
    deleted_at = now(),
    updated_by = actor_id
  where bills.id = bill_row.id
  returning * into bill_row;

  perform set_config('app.allow_bill_lifecycle', 'off', true);

  return jsonb_build_object('bill', to_jsonb(bill_row));
end;
$$;

create or replace function public.receive_bill(
  p_bill_id uuid,
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
  bill_row public.bills;
  vendor_row public.vendors;
  snapshot jsonb;
  lines_json jsonb;
  receive_date date;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into bill_row
  from public.bills
  where bills.id = p_bill_id
    and bills.org_id = p_org_id
    and bills.deleted_at is null
  for update;

  if not found then
    raise exception 'Bill not found'
      using errcode = 'P0002';
  end if;

  if bill_row.version is distinct from p_expected_version then
    raise exception 'Bill version conflict'
      using errcode = 'P0001';
  end if;

  if bill_row.status <> 'draft' then
    raise exception 'Only draft bills can be received'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.bill_lines where bill_lines.bill_id = bill_row.id
  ) then
    raise exception 'Bill must have at least one line before receive'
      using errcode = '22023';
  end if;

  select * into vendor_row
  from public.vendors
  where vendors.id = bill_row.vendor_id
    and vendors.org_id = p_org_id
    and vendors.deleted_at is null;

  if not found then
    raise exception 'Bill vendor must be an active vendor in the same organisation'
      using errcode = '22023';
  end if;

  if bill_row.party_snapshot ? 'vendor' then
    snapshot := bill_row.party_snapshot;
  else
    snapshot := jsonb_build_object(
      'vendor', jsonb_build_object(
        'id', vendor_row.id,
        'name', vendor_row.name,
        'primary_email', vendor_row.primary_email,
        'phone', vendor_row.phone,
        'tax_identifier', vendor_row.tax_identifier,
        'default_currency', vendor_row.default_currency,
        'payment_terms_days', vendor_row.payment_terms_days
      )
    );
  end if;

  receive_date := coalesce(bill_row.received_on, (timezone('utc', now()))::date);

  perform set_config('app.allow_bill_lifecycle', 'on', true);

  update public.bills
  set
    status = 'received',
    received_on = receive_date,
    party_snapshot = snapshot,
    updated_by = actor_id
  where bills.id = bill_row.id
  returning * into bill_row;

  perform set_config('app.allow_bill_lifecycle', 'off', true);

  select coalesce(
    jsonb_agg(to_jsonb(bill_lines) order by bill_lines.position, bill_lines.id),
    '[]'::jsonb
  )
  into lines_json
  from public.bill_lines
  where bill_lines.bill_id = bill_row.id;

  return jsonb_build_object(
    'bill', to_jsonb(bill_row),
    'lines', lines_json
  );
end;
$$;

create or replace function public.void_bill(
  p_bill_id uuid,
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
  bill_row public.bills;
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
  if reason is null or char_length(reason) > 500 then
    raise exception 'Void reason is required and must be at most 500 characters'
      using errcode = '22023';
  end if;

  select * into bill_row
  from public.bills
  where bills.id = p_bill_id
    and bills.org_id = p_org_id
    and bills.deleted_at is null
  for update;

  if not found then
    raise exception 'Bill not found'
      using errcode = 'P0002';
  end if;

  if bill_row.version is distinct from p_expected_version then
    raise exception 'Bill version conflict'
      using errcode = 'P0001';
  end if;

  if bill_row.status not in ('draft', 'received') then
    raise exception 'Only draft or received bills can be voided'
      using errcode = '22023';
  end if;

  perform set_config('app.allow_bill_lifecycle', 'on', true);

  update public.bills
  set
    status = 'void',
    voided_at = now(),
    void_reason = reason,
    paid_cents = 0,
    balance_due_cents = 0,
    updated_by = actor_id
  where bills.id = bill_row.id
  returning * into bill_row;

  perform set_config('app.allow_bill_lifecycle', 'off', true);

  select coalesce(
    jsonb_agg(to_jsonb(bill_lines) order by bill_lines.position, bill_lines.id),
    '[]'::jsonb
  )
  into lines_json
  from public.bill_lines
  where bill_lines.bill_id = bill_row.id;

  return jsonb_build_object(
    'bill', to_jsonb(bill_row),
    'lines', lines_json
  );
end;
$$;

revoke all on function public.create_bill_draft(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.save_bill_draft(uuid, uuid, integer, jsonb, jsonb) from public, anon;
revoke all on function public.get_bill_document(uuid, uuid) from public, anon;
revoke all on function public.soft_delete_bill_draft(uuid, uuid, integer) from public, anon;
revoke all on function public.receive_bill(uuid, uuid, integer) from public, anon;
revoke all on function public.void_bill(uuid, uuid, integer, text) from public, anon;

grant execute on function public.create_bill_draft(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.save_bill_draft(uuid, uuid, integer, jsonb, jsonb) to authenticated;
grant execute on function public.get_bill_document(uuid, uuid) to authenticated;
grant execute on function public.soft_delete_bill_draft(uuid, uuid, integer) to authenticated;
grant execute on function public.receive_bill(uuid, uuid, integer) to authenticated;
grant execute on function public.void_bill(uuid, uuid, integer, text) to authenticated;

revoke all on function private.validate_bill_party_refs() from public, anon, authenticated;
revoke all on function private.protect_bill_draft_columns() from public, anon, authenticated;
revoke all on function private.protect_bill_line_direct_writes()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------------

alter table public.vendors enable row level security;
alter table public.bills enable row level security;
alter table public.bill_lines enable row level security;

create policy vendors_select_member
on public.vendors
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'billing', 'readonly']
  )
);

create policy vendors_insert_member
on public.vendors
for insert
to authenticated
with check (
  private.has_org_role(
    org_id,
    array['owner', 'admin', 'member']
  )
  and created_by = auth.uid()
  and updated_by = auth.uid()
);

create policy vendors_update_member
on public.vendors
for update
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member']
  )
)
with check (
  private.has_org_role(
    org_id,
    array['owner', 'admin', 'member']
  )
  and updated_by = auth.uid()
);

create policy bills_select_member
on public.bills
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'billing', 'readonly']
  )
);

create policy bill_lines_select_member
on public.bill_lines
for select
to authenticated
using (
  private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'billing', 'readonly']
  )
  and exists (
    select 1
    from public.bills
    where bills.id = bill_lines.bill_id
      and bills.org_id = bill_lines.org_id
      and bills.deleted_at is null
  )
);

revoke all on table public.vendors from public, anon, authenticated;
revoke all on table public.bills from public, anon, authenticated;
revoke all on table public.bill_lines from public, anon, authenticated;

-- Omit bank_details_encrypted from table-level select; Edge never selects it.
grant select (
  id,
  org_id,
  created_at,
  updated_at,
  created_by,
  updated_by,
  deleted_at,
  version,
  name,
  status,
  primary_email,
  phone,
  website_url,
  tax_identifier,
  default_currency,
  payment_terms_days,
  notes,
  metadata
) on table public.vendors to authenticated;

grant insert (
  org_id,
  name,
  status,
  primary_email,
  phone,
  website_url,
  tax_identifier,
  default_currency,
  payment_terms_days,
  bank_details_encrypted,
  notes,
  metadata
) on table public.vendors to authenticated;

grant update (
  name,
  status,
  primary_email,
  phone,
  website_url,
  tax_identifier,
  default_currency,
  payment_terms_days,
  bank_details_encrypted,
  notes,
  metadata,
  deleted_at
) on table public.vendors to authenticated;

grant select on table public.bills to authenticated;
grant select on table public.bill_lines to authenticated;

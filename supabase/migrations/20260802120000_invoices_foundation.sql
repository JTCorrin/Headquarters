-- Invoice foundation: document sequences (invoice), invoices/invoice_lines, draft RPCs,
-- and the draft → sent → void lifecycle. Payment allocation, partial/paid transitions, and
-- recurring schedules are intentionally deferred (see PLANS/CRM_RECURRING_INVOICES.md).

set search_path = public, extensions, pg_catalog;

-- ---------------------------------------------------------------------------
-- document_sequences — seed invoice numbering for existing and new organisations
-- ---------------------------------------------------------------------------

insert into public.document_sequences (org_id, document_type, prefix, next_number, padding)
select organisations.id, 'invoice', 'INV-', 1, 4
from public.organisations
where organisations.deleted_at is null
on conflict (org_id, document_type) do nothing;

create or replace function public.create_organisation(
  p_name text,
  p_slug text,
  p_country_code text,
  p_default_currency text default 'GBP',
  p_timezone text default 'UTC',
  p_locale text default 'en-GB'
)
returns public.organisations
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  created_org public.organisations;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if nullif(trim(p_name), '') is null then
    raise exception 'Organisation name is required'
      using errcode = '22023';
  end if;

  if p_slug is null or lower(trim(p_slug)) !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'Organisation slug is invalid'
      using errcode = '22023';
  end if;

  insert into public.organisations (
    name,
    slug,
    country_code,
    default_currency,
    timezone,
    locale
  )
  values (
    trim(p_name),
    lower(trim(p_slug)),
    upper(trim(p_country_code)),
    upper(trim(p_default_currency)),
    coalesce(nullif(trim(p_timezone), ''), 'UTC'),
    coalesce(nullif(trim(p_locale), ''), 'en-GB')
  )
  returning * into created_org;

  insert into public.memberships (org_id, user_id, role, status)
  values (created_org.id, actor_id, 'owner', 'active');

  insert into public.document_sequences (
    org_id,
    document_type,
    prefix,
    next_number,
    padding
  )
  values
    (created_org.id, 'quote', 'Q-', 1, 4),
    (created_org.id, 'invoice', 'INV-', 1, 4);

  return created_org;
end;
$$;

revoke all on function public.create_organisation(text, text, text, text, text, text)
  from public, anon;
grant execute on function public.create_organisation(text, text, text, text, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- invoices / invoice_lines
-- ---------------------------------------------------------------------------

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  number text not null check (char_length(number) between 1 and 64),
  client_id uuid not null,
  contact_id uuid,
  quote_id uuid,
  owner_membership_id uuid,
  source text not null default 'manual',
  recurring_run_id uuid,
  billing_period_start date,
  billing_period_end date,
  status text not null default 'draft',
  currency char(3) not null,
  issue_on date not null default (timezone('utc', now()))::date,
  due_on date not null,
  purchase_order_number text,
  subtotal_cents bigint not null default 0 check (subtotal_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  paid_cents bigint not null default 0 check (paid_cents >= 0),
  balance_due_cents bigint not null default 0 check (balance_due_cents >= 0),
  party_snapshot jsonb not null default '{}'::jsonb,
  payment_terms text,
  notes text,
  internal_notes text,
  sent_at timestamptz,
  viewed_at timestamptz,
  paid_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  constraint invoices_org_id_id_key unique (org_id, id),
  constraint invoices_client_fk
    foreign key (org_id, client_id)
    references public.clients (org_id, id)
    on delete restrict,
  constraint invoices_contact_fk
    foreign key (org_id, contact_id)
    references public.contacts (org_id, id)
    on delete set null (contact_id),
  constraint invoices_quote_fk
    foreign key (org_id, quote_id)
    references public.quotes (org_id, id)
    on delete set null (quote_id),
  constraint invoices_owner_membership_fk
    foreign key (org_id, owner_membership_id)
    references public.memberships (org_id, id)
    on delete set null (owner_membership_id),
  constraint invoices_source_check
    check (source in ('manual', 'quote', 'recurring')),
  constraint invoices_status_check
    check (status in ('draft', 'sent', 'partial', 'paid', 'void')),
  constraint invoices_currency_format_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint invoices_discount_lte_subtotal_check
    check (discount_cents <= subtotal_cents),
  constraint invoices_paid_lte_total_check
    check (paid_cents <= total_cents),
  constraint invoices_party_snapshot_object_check
    check (jsonb_typeof(party_snapshot) = 'object'),
  constraint invoices_due_on_check
    check (due_on >= issue_on),
  constraint invoices_billing_period_check
    check (
      billing_period_start is null
      or billing_period_end is null
      or billing_period_end >= billing_period_start
    ),
  constraint invoices_void_reason_required_check
    check (status <> 'void' or void_reason is not null)
);

create unique index invoices_org_number_uidx
  on public.invoices (org_id, number)
  where deleted_at is null;

create index invoices_org_created_idx
  on public.invoices (org_id, created_at desc, id desc)
  where deleted_at is null;

create index invoices_org_status_issue_idx
  on public.invoices (org_id, status, issue_on desc)
  where deleted_at is null;

create index invoices_org_quote_idx
  on public.invoices (org_id, quote_id)
  where quote_id is not null;

create unique index invoices_recurring_run_uidx
  on public.invoices (recurring_run_id)
  where recurring_run_id is not null;

create trigger invoices_stamp_business_row
before insert or update on public.invoices
for each row execute function private.stamp_business_row();

-- Invoices did not exist when quotes were created; wire the conversion FK now.
alter table public.quotes
  add constraint quotes_converted_invoice_fk
  foreign key (org_id, converted_invoice_id)
  references public.invoices (org_id, id)
  on delete set null;

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  version integer not null default 1 check (version > 0),
  invoice_id uuid not null,
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
  constraint invoice_lines_org_id_id_key unique (org_id, id),
  constraint invoice_lines_invoice_fk
    foreign key (org_id, invoice_id)
    references public.invoices (org_id, id)
    on delete cascade,
  constraint invoice_lines_product_fk
    foreign key (org_id, product_id)
    references public.products (org_id, id)
    on delete restrict,
  constraint invoice_lines_quantity_check
    check (
      lower(quantity::text) not in ('nan', 'infinity', '-infinity')
      and quantity > 0
    ),
  constraint invoice_lines_discount_percent_check
    check (
      lower(discount_percent::text) not in ('nan', 'infinity', '-infinity')
      and discount_percent >= 0
      and discount_percent <= 100
    ),
  constraint invoice_lines_tax_rate_percent_check
    check (
      lower(tax_rate_percent::text) not in ('nan', 'infinity', '-infinity')
      and tax_rate_percent >= 0
      and tax_rate_percent <= 100
    )
);

create unique index invoice_lines_invoice_position_uidx
  on public.invoice_lines (invoice_id, position);

create index invoice_lines_org_invoice_idx
  on public.invoice_lines (org_id, invoice_id, position);

create trigger invoice_lines_stamp_business_row
before insert or update on public.invoice_lines
for each row execute function private.stamp_business_row();

-- ---------------------------------------------------------------------------
-- Validation / protection triggers
-- ---------------------------------------------------------------------------

create or replace function private.validate_invoice_party_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Soft-delete must succeed even if linked parties were later removed/suspended.
  if tg_op = 'UPDATE'
    and new.deleted_at is not null
    and old.deleted_at is null
  then
    return new;
  end if;

  if new.client_id is not null
    and (
      tg_op = 'INSERT'
      or new.client_id is distinct from old.client_id
    )
    and not exists (
      select 1
      from public.clients
      where clients.id = new.client_id
        and clients.org_id = new.org_id
        and clients.deleted_at is null
    )
  then
    raise exception 'Invoice client must be an active client in the same organisation'
      using errcode = '22023';
  end if;

  if new.contact_id is not null
    and (
      tg_op = 'INSERT'
      or new.contact_id is distinct from old.contact_id
    )
    and not exists (
      select 1
      from public.contacts
      where contacts.id = new.contact_id
        and contacts.org_id = new.org_id
        and contacts.deleted_at is null
    )
  then
    raise exception 'Invoice contact must be an active contact in the same organisation'
      using errcode = '22023';
  end if;

  if new.quote_id is not null
    and (
      tg_op = 'INSERT'
      or new.quote_id is distinct from old.quote_id
    )
    and not exists (
      select 1
      from public.quotes
      where quotes.id = new.quote_id
        and quotes.org_id = new.org_id
        and quotes.deleted_at is null
    )
  then
    raise exception 'Invoice quote must belong to the same organisation'
      using errcode = '22023';
  end if;

  if new.owner_membership_id is not null
    and (
      tg_op = 'INSERT'
      or new.owner_membership_id is distinct from old.owner_membership_id
    )
    and not exists (
      select 1
      from public.memberships
      where memberships.id = new.owner_membership_id
        and memberships.org_id = new.org_id
        and memberships.status = 'active'
    )
  then
    raise exception 'Invoice owner must be an active membership in the same organisation'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger invoices_validate_party_refs
before insert or update on public.invoices
for each row execute function private.validate_invoice_party_refs();

create or replace function private.protect_invoice_draft_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.deleted_at is not null then
      raise exception 'Soft-deleted invoices cannot be updated'
        using errcode = '22023';
    end if;

    if old.status <> 'draft'
      and current_setting('app.allow_invoice_lifecycle', true) is distinct from 'on'
    then
      raise exception 'Only draft invoices can be edited in this release'
        using errcode = '22023';
    end if;

    if new.number is distinct from old.number then
      raise exception 'Invoice number is immutable'
        using errcode = '22023';
    end if;

    if current_setting('app.allow_invoice_totals', true) is distinct from 'on'
      and current_setting('app.allow_invoice_lifecycle', true) is distinct from 'on'
      and (
        new.subtotal_cents is distinct from old.subtotal_cents
        or new.discount_cents is distinct from old.discount_cents
        or new.tax_cents is distinct from old.tax_cents
        or new.total_cents is distinct from old.total_cents
        or new.paid_cents is distinct from old.paid_cents
        or new.balance_due_cents is distinct from old.balance_due_cents
        or new.status is distinct from old.status
        or new.party_snapshot is distinct from old.party_snapshot
        or new.sent_at is distinct from old.sent_at
        or new.viewed_at is distinct from old.viewed_at
        or new.paid_at is distinct from old.paid_at
        or new.voided_at is distinct from old.voided_at
        or new.void_reason is distinct from old.void_reason
      )
    then
      raise exception 'Calculated or lifecycle invoice fields are not writable'
        using errcode = '22023';
    end if;
  end if;

  if tg_op = 'INSERT'
    and current_setting('app.allow_invoice_totals', true) is distinct from 'on'
    and current_setting('app.allow_invoice_lifecycle', true) is distinct from 'on'
  then
    raise exception 'Invoices must be created through the draft RPC'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger invoices_protect_draft_columns
before insert or update on public.invoices
for each row execute function private.protect_invoice_draft_columns();

create or replace function private.protect_invoice_line_direct_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.allow_invoice_totals', true) is distinct from 'on' then
    raise exception 'Invoice lines must be written through the draft RPC'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger invoice_lines_protect_direct_writes
before insert or update or delete on public.invoice_lines
for each row execute function private.protect_invoice_line_direct_writes();

-- ---------------------------------------------------------------------------
-- Totals helpers + draft RPCs
-- ---------------------------------------------------------------------------

-- Line money math and JSON-safe-cents assertion are pure/generic; reuse the
-- quote-foundation helpers (private.calculate_quote_line_amounts,
-- private.assert_json_safe_cents) instead of duplicating them for invoices.

drop function if exists private.replace_invoice_lines(uuid, uuid, uuid, jsonb, char);

create or replace function private.replace_invoice_lines(
  p_org_id uuid,
  p_invoice_id uuid,
  p_actor_id uuid,
  p_lines jsonb,
  p_invoice_currency char(3)
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
    raise exception 'Invoice lines must be an array'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_lines) > 200 then
    raise exception 'Invoice cannot exceed 200 lines'
      using errcode = '22023';
  end if;

  if p_invoice_currency is null or p_invoice_currency !~ '^[A-Z]{3}$' then
    raise exception 'Invoice currency must be a 3-letter ISO code'
      using errcode = '22023';
  end if;

  delete from public.invoice_lines
  where invoice_lines.invoice_id = p_invoice_id
    and invoice_lines.org_id = p_org_id;

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
      raise exception 'Invoice line quantity must be greater than zero'
        using errcode = '22023';
    end if;

    if line_discount < 0 or line_discount > 100
      or lower(line_discount::text) in ('nan', 'infinity', '-infinity')
    then
      raise exception 'Invoice line discount_percent must be between 0 and 100'
        using errcode = '22023';
    end if;

    if line_position < 0 then
      raise exception 'Invoice line position must be non-negative'
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
        raise exception 'Invoice line product must be an active product in the same organisation'
          using errcode = '22023';
      end if;

      if product_row.currency is distinct from p_invoice_currency then
        raise exception 'Invoice line product currency must match invoice currency'
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
        raise exception 'Free-text invoice lines require unit_price_cents'
          using errcode = '22023';
      end if;
      line_unit_price := (line_item ->> 'unit_price_cents')::bigint;
      line_tax_rate := coalesce((line_item ->> 'tax_rate_percent')::numeric, 0);
    end if;

    if line_description is null or char_length(line_description) > 200 then
      raise exception 'Invoice line description must be between 1 and 200 characters'
        using errcode = '22023';
    end if;

    if line_unit_price is null or line_unit_price < 0 then
      raise exception 'Invoice line unit_price_cents must be a non-negative integer'
        using errcode = '22023';
    end if;

    if line_tax_rate < 0 or line_tax_rate > 100
      or lower(line_tax_rate::text) in ('nan', 'infinity', '-infinity')
    then
      raise exception 'Invoice line tax_rate_percent must be between 0 and 100'
        using errcode = '22023';
    end if;

    if line_unit_price > 0
      and line_quantity > (json_safe_max::numeric / line_unit_price::numeric)
    then
      raise exception 'Invoice line totals exceed JSON-safe integer range'
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
      raise exception 'Invoice line totals exceed JSON-safe integer range'
        using errcode = '22023';
    end if;

    if header_subtotal > json_safe_max - amounts.subtotal_cents
      or header_tax > json_safe_max - amounts.tax_cents
    then
      raise exception 'Invoice totals exceed JSON-safe integer range'
        using errcode = '22023';
    end if;

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
    values (
      p_org_id,
      p_invoice_id,
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

revoke all on function private.replace_invoice_lines(uuid, uuid, uuid, jsonb, char)
  from public, anon, authenticated;

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
  p_lines jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  invoice_row public.invoices;
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
  p_org_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  invoice_row public.invoices;
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

create or replace function public.soft_delete_invoice_draft(
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
    raise exception 'Only draft invoices can be deleted in this release'
      using errcode = '22023';
  end if;

  perform set_config('app.allow_invoice_totals', 'on', true);

  update public.invoices
  set
    deleted_at = now(),
    updated_by = actor_id
  where invoices.id = invoice_row.id
  returning * into invoice_row;

  perform set_config('app.allow_invoice_totals', 'off', true);

  return jsonb_build_object('invoice', to_jsonb(invoice_row));
end;
$$;

-- ---------------------------------------------------------------------------
-- Lifecycle RPCs: send, void, quote accept (conversion prerequisite), conversion
-- ---------------------------------------------------------------------------

-- Thin quote accept so conversion is reachable via the public API. Full quote
-- send/reject lifecycle remains a later slice; this only freezes draft|sent → accepted.
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

  return jsonb_build_object(
    'quote', to_jsonb(quote_row),
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

  -- Idempotent reconvert: return the previously converted invoice unchanged.
  if quote_row.converted_invoice_id is not null then
    select * into invoice_row
    from public.invoices
    where invoices.id = quote_row.converted_invoice_id
      and invoices.org_id = p_org_id;

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

  return jsonb_build_object(
    'invoice', to_jsonb(invoice_row),
    'lines', lines_json,
    'created', true
  );
end;
$$;

revoke all on function public.accept_quote(uuid, uuid, integer) from public, anon;
revoke all on function public.create_invoice_draft(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.save_invoice_draft(uuid, uuid, integer, jsonb, jsonb)
  from public, anon;
revoke all on function public.get_invoice_document(uuid, uuid) from public, anon;
revoke all on function public.soft_delete_invoice_draft(uuid, uuid, integer)
  from public, anon;
revoke all on function public.send_invoice(uuid, uuid, integer) from public, anon;
revoke all on function public.void_invoice(uuid, uuid, integer, text) from public, anon;
revoke all on function public.create_invoice_from_quote(uuid, uuid) from public, anon;

grant execute on function public.accept_quote(uuid, uuid, integer) to authenticated;
grant execute on function public.create_invoice_draft(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.save_invoice_draft(uuid, uuid, integer, jsonb, jsonb)
  to authenticated;
grant execute on function public.get_invoice_document(uuid, uuid) to authenticated;
grant execute on function public.soft_delete_invoice_draft(uuid, uuid, integer)
  to authenticated;
grant execute on function public.send_invoice(uuid, uuid, integer) to authenticated;
grant execute on function public.void_invoice(uuid, uuid, integer, text) to authenticated;
grant execute on function public.create_invoice_from_quote(uuid, uuid) to authenticated;

revoke all on function private.validate_invoice_party_refs() from public, anon, authenticated;
revoke all on function private.protect_invoice_draft_columns() from public, anon, authenticated;
revoke all on function private.protect_invoice_line_direct_writes()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------------

alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;

create policy invoices_select_member
on public.invoices
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'billing', 'readonly']
  )
);

-- Mutations go through security-definer RPCs; no insert/update/delete policies.

create policy invoice_lines_select_member
on public.invoice_lines
for select
to authenticated
using (
  private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'billing', 'readonly']
  )
  and exists (
    select 1
    from public.invoices
    where invoices.id = invoice_lines.invoice_id
      and invoices.org_id = invoice_lines.org_id
      and invoices.deleted_at is null
  )
);

revoke all on table public.invoices from public, anon, authenticated;
revoke all on table public.invoice_lines from public, anon, authenticated;

grant select on table public.invoices to authenticated;
grant select on table public.invoice_lines to authenticated;

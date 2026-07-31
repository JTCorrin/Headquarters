-- Quote draft foundation: document sequences, quotes/quote_lines, draft RPCs.
-- Send/accept/create-invoice commands intentionally deferred.

set search_path = public, extensions, pg_catalog;

-- ---------------------------------------------------------------------------
-- document_sequences — concurrency-safe per-org numbering
-- ---------------------------------------------------------------------------

create table public.document_sequences (
  org_id uuid not null references public.organisations (id) on delete cascade,
  document_type text not null,
  prefix text not null check (char_length(prefix) between 1 and 16),
  next_number bigint not null default 1 check (next_number >= 1),
  padding smallint not null default 4 check (padding between 1 and 12),
  constraint document_sequences_pkey primary key (org_id, document_type),
  constraint document_sequences_type_check
    check (document_type in ('quote', 'invoice', 'bill'))
);

alter table public.document_sequences enable row level security;
revoke all on table public.document_sequences from public, anon, authenticated;

-- Backfill quote sequences for existing organisations.
insert into public.document_sequences (org_id, document_type, prefix, next_number, padding)
select organisations.id, 'quote', 'Q-', 1, 4
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
  values (created_org.id, 'quote', 'Q-', 1, 4);

  return created_org;
end;
$$;

revoke all on function public.create_organisation(text, text, text, text, text, text)
  from public, anon;
grant execute on function public.create_organisation(text, text, text, text, text, text)
  to authenticated;

create or replace function private.allocate_document_number(
  p_org_id uuid,
  p_document_type text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  seq_row public.document_sequences;
  allocated text;
begin
  if p_document_type not in ('quote', 'invoice', 'bill') then
    raise exception 'Document type is invalid'
      using errcode = '22023';
  end if;

  select * into seq_row
  from public.document_sequences
  where document_sequences.org_id = p_org_id
    and document_sequences.document_type = p_document_type
  for update;

  if not found then
    insert into public.document_sequences (
      org_id,
      document_type,
      prefix,
      next_number,
      padding
    )
    values (
      p_org_id,
      p_document_type,
      case p_document_type
        when 'quote' then 'Q-'
        when 'invoice' then 'INV-'
        else 'BILL-'
      end,
      1,
      4
    )
    on conflict (org_id, document_type) do nothing;

    select * into seq_row
    from public.document_sequences
    where document_sequences.org_id = p_org_id
      and document_sequences.document_type = p_document_type
    for update;
  end if;

  if not found then
    raise exception 'Document sequence is unavailable'
      using errcode = 'P0002';
  end if;

  allocated := seq_row.prefix
    || lpad(seq_row.next_number::text, seq_row.padding, '0');

  update public.document_sequences
  set next_number = document_sequences.next_number + 1
  where document_sequences.org_id = p_org_id
    and document_sequences.document_type = p_document_type;

  return allocated;
end;
$$;

revoke all on function private.allocate_document_number(uuid, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- quotes / quote_lines
-- ---------------------------------------------------------------------------

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  number text not null check (char_length(number) between 1 and 64),
  title text not null check (char_length(title) between 1 and 160),
  client_id uuid,
  lead_id uuid,
  contact_id uuid,
  owner_membership_id uuid,
  status text not null default 'draft',
  currency char(3) not null,
  issue_on date not null default (timezone('utc', now()))::date,
  valid_until date,
  subtotal_cents bigint not null default 0 check (subtotal_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  party_snapshot jsonb not null default '{}'::jsonb,
  terms text,
  notes text,
  internal_notes text,
  sent_at timestamptz,
  viewed_at timestamptz,
  accepted_at timestamptz,
  rejected_at timestamptz,
  converted_invoice_id uuid,
  constraint quotes_org_id_id_key unique (org_id, id),
  constraint quotes_client_fk
    foreign key (org_id, client_id)
    references public.clients (org_id, id)
    on delete restrict,
  constraint quotes_lead_fk
    foreign key (org_id, lead_id)
    references public.leads (org_id, id)
    on delete restrict,
  constraint quotes_contact_fk
    foreign key (org_id, contact_id)
    references public.contacts (org_id, id)
    on delete set null (contact_id),
  constraint quotes_owner_membership_fk
    foreign key (org_id, owner_membership_id)
    references public.memberships (org_id, id)
    on delete set null (owner_membership_id),
  constraint quotes_party_or_lead_check
    check (client_id is not null or lead_id is not null),
  constraint quotes_status_check
    check (status in ('draft', 'sent', 'accepted', 'rejected', 'expired', 'void')),
  constraint quotes_currency_format_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint quotes_discount_lte_subtotal_check
    check (discount_cents <= subtotal_cents),
  constraint quotes_party_snapshot_object_check
    check (jsonb_typeof(party_snapshot) = 'object'),
  constraint quotes_valid_until_check
    check (valid_until is null or valid_until >= issue_on)
);

create unique index quotes_org_number_uidx
  on public.quotes (org_id, number)
  where deleted_at is null;

create index quotes_org_created_idx
  on public.quotes (org_id, created_at desc, id desc)
  where deleted_at is null;

create index quotes_org_status_issue_idx
  on public.quotes (org_id, status, issue_on desc)
  where deleted_at is null;

create trigger quotes_stamp_business_row
before insert or update on public.quotes
for each row execute function private.stamp_business_row();

create table public.quote_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  version integer not null default 1 check (version > 0),
  quote_id uuid not null,
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
  constraint quote_lines_org_id_id_key unique (org_id, id),
  constraint quote_lines_quote_fk
    foreign key (org_id, quote_id)
    references public.quotes (org_id, id)
    on delete cascade,
  constraint quote_lines_product_fk
    foreign key (org_id, product_id)
    references public.products (org_id, id)
    on delete restrict,
  constraint quote_lines_quantity_check
    check (
      lower(quantity::text) not in ('nan', 'infinity', '-infinity')
      and quantity > 0
    ),
  constraint quote_lines_discount_percent_check
    check (
      lower(discount_percent::text) not in ('nan', 'infinity', '-infinity')
      and discount_percent >= 0
      and discount_percent <= 100
    ),
  constraint quote_lines_tax_rate_percent_check
    check (
      lower(tax_rate_percent::text) not in ('nan', 'infinity', '-infinity')
      and tax_rate_percent >= 0
      and tax_rate_percent <= 100
    )
);

create unique index quote_lines_quote_position_uidx
  on public.quote_lines (quote_id, position);

create index quote_lines_org_quote_idx
  on public.quote_lines (org_id, quote_id, position);

create trigger quote_lines_stamp_business_row
before insert or update on public.quote_lines
for each row execute function private.stamp_business_row();

-- ---------------------------------------------------------------------------
-- Validation / protection triggers
-- ---------------------------------------------------------------------------

create or replace function private.validate_quote_party_refs()
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
    raise exception 'Quote client must be an active client in the same organisation'
      using errcode = '22023';
  end if;

  if new.lead_id is not null
    and (
      tg_op = 'INSERT'
      or new.lead_id is distinct from old.lead_id
    )
    and not exists (
      select 1
      from public.leads
      where leads.id = new.lead_id
        and leads.org_id = new.org_id
        and leads.deleted_at is null
    )
  then
    raise exception 'Quote lead must be an active lead in the same organisation'
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
    raise exception 'Quote contact must be an active contact in the same organisation'
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
    raise exception 'Quote owner must be an active membership in the same organisation'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger quotes_validate_party_refs
before insert or update on public.quotes
for each row execute function private.validate_quote_party_refs();

create or replace function private.protect_quote_draft_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.deleted_at is not null then
      raise exception 'Soft-deleted quotes cannot be updated'
        using errcode = '22023';
    end if;

    if old.status <> 'draft' and current_setting('app.allow_quote_lifecycle', true) is distinct from 'on'
    then
      raise exception 'Only draft quotes can be edited in this release'
        using errcode = '22023';
    end if;

    if new.number is distinct from old.number then
      raise exception 'Quote number is immutable'
        using errcode = '22023';
    end if;

    if current_setting('app.allow_quote_totals', true) is distinct from 'on'
      and (
        new.subtotal_cents is distinct from old.subtotal_cents
        or new.tax_cents is distinct from old.tax_cents
        or new.total_cents is distinct from old.total_cents
        or new.status is distinct from old.status
        or new.party_snapshot is distinct from old.party_snapshot
        or new.sent_at is distinct from old.sent_at
        or new.viewed_at is distinct from old.viewed_at
        or new.accepted_at is distinct from old.accepted_at
        or new.rejected_at is distinct from old.rejected_at
        or new.converted_invoice_id is distinct from old.converted_invoice_id
      )
    then
      raise exception 'Calculated or lifecycle quote fields are not writable'
        using errcode = '22023';
    end if;
  end if;

  if tg_op = 'INSERT'
    and current_setting('app.allow_quote_totals', true) is distinct from 'on'
  then
    raise exception 'Quotes must be created through the draft RPC'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger quotes_protect_draft_columns
before insert or update on public.quotes
for each row execute function private.protect_quote_draft_columns();

create or replace function private.protect_quote_line_direct_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.allow_quote_totals', true) is distinct from 'on' then
    raise exception 'Quote lines must be written through the draft RPC'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger quote_lines_protect_direct_writes
before insert or update or delete on public.quote_lines
for each row execute function private.protect_quote_line_direct_writes();

-- ---------------------------------------------------------------------------
-- Totals helpers + draft RPCs
-- ---------------------------------------------------------------------------

create or replace function private.calculate_quote_line_amounts(
  p_quantity numeric,
  p_unit_price_cents bigint,
  p_discount_percent numeric,
  p_tax_rate_percent numeric
)
returns table (
  subtotal_cents bigint,
  tax_cents bigint,
  total_cents bigint
)
language sql
immutable
set search_path = ''
as $$
  select
    line_subtotal,
    line_tax,
    line_subtotal + line_tax
  from (
    select
      round(
        (p_quantity * p_unit_price_cents::numeric)
        * (1 - coalesce(p_discount_percent, 0) / 100.0)
      )::bigint as line_subtotal,
      round(
        round(
          (p_quantity * p_unit_price_cents::numeric)
          * (1 - coalesce(p_discount_percent, 0) / 100.0)
        )
        * (coalesce(p_tax_rate_percent, 0) / 100.0)
      )::bigint as line_tax
  ) amounts;
$$;

revoke all on function private.calculate_quote_line_amounts(numeric, bigint, numeric, numeric)
  from public, anon, authenticated;

create or replace function private.assert_json_safe_cents(
  p_amount bigint,
  p_label text
)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_amount is null
    or p_amount < 0
    or p_amount > 9007199254740991
  then
    raise exception '% exceeds JSON-safe integer range', p_label
      using errcode = '22023';
  end if;
  return p_amount;
end;
$$;

revoke all on function private.assert_json_safe_cents(bigint, text)
  from public, anon, authenticated;

drop function if exists private.replace_quote_lines(uuid, uuid, uuid, jsonb);

create or replace function private.replace_quote_lines(
  p_org_id uuid,
  p_quote_id uuid,
  p_actor_id uuid,
  p_lines jsonb,
  p_quote_currency char(3)
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
    raise exception 'Quote lines must be an array'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_lines) > 200 then
    raise exception 'Quote cannot exceed 200 lines'
      using errcode = '22023';
  end if;

  if p_quote_currency is null or p_quote_currency !~ '^[A-Z]{3}$' then
    raise exception 'Quote currency must be a 3-letter ISO code'
      using errcode = '22023';
  end if;

  delete from public.quote_lines
  where quote_lines.quote_id = p_quote_id
    and quote_lines.org_id = p_org_id;

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
      raise exception 'Quote line quantity must be greater than zero'
        using errcode = '22023';
    end if;

    if line_discount < 0 or line_discount > 100
      or lower(line_discount::text) in ('nan', 'infinity', '-infinity')
    then
      raise exception 'Quote line discount_percent must be between 0 and 100'
        using errcode = '22023';
    end if;

    if line_position < 0 then
      raise exception 'Quote line position must be non-negative'
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
        raise exception 'Quote line product must be an active product in the same organisation'
          using errcode = '22023';
      end if;

      if product_row.currency is distinct from p_quote_currency then
        raise exception 'Quote line product currency must match quote currency'
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
        raise exception 'Free-text quote lines require unit_price_cents'
          using errcode = '22023';
      end if;
      line_unit_price := (line_item ->> 'unit_price_cents')::bigint;
      line_tax_rate := coalesce((line_item ->> 'tax_rate_percent')::numeric, 0);
    end if;

    if line_description is null or char_length(line_description) > 200 then
      raise exception 'Quote line description must be between 1 and 200 characters'
        using errcode = '22023';
    end if;

    if line_unit_price is null or line_unit_price < 0 then
      raise exception 'Quote line unit_price_cents must be a non-negative integer'
        using errcode = '22023';
    end if;

    if line_tax_rate < 0 or line_tax_rate > 100
      or lower(line_tax_rate::text) in ('nan', 'infinity', '-infinity')
    then
      raise exception 'Quote line tax_rate_percent must be between 0 and 100'
        using errcode = '22023';
    end if;

    if line_unit_price > 0
      and line_quantity > (json_safe_max::numeric / line_unit_price::numeric)
    then
      raise exception 'Quote line totals exceed JSON-safe integer range'
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
      raise exception 'Quote line totals exceed JSON-safe integer range'
        using errcode = '22023';
    end if;

    if header_subtotal > json_safe_max - amounts.subtotal_cents
      or header_tax > json_safe_max - amounts.tax_cents
    then
      raise exception 'Quote totals exceed JSON-safe integer range'
        using errcode = '22023';
    end if;

    insert into public.quote_lines (
      org_id,
      quote_id,
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
      p_quote_id,
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

revoke all on function private.replace_quote_lines(uuid, uuid, uuid, jsonb, char)
  from public, anon, authenticated;

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
  p_lines jsonb default null
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
  lines_json jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(
    p_org_id,
    array['owner', 'admin', 'member', 'readonly']
  ) then
    raise exception 'This action is not permitted'
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

create or replace function public.soft_delete_quote_draft(
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

  if quote_row.status <> 'draft' then
    raise exception 'Only draft quotes can be deleted in this release'
      using errcode = '22023';
  end if;

  perform set_config('app.allow_quote_totals', 'on', true);

  update public.quotes
  set
    deleted_at = now(),
    updated_by = actor_id
  where quotes.id = quote_row.id
  returning * into quote_row;

  perform set_config('app.allow_quote_totals', 'off', true);

  return jsonb_build_object('quote', to_jsonb(quote_row));
end;
$$;

revoke all on function public.create_quote_draft(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.save_quote_draft(uuid, uuid, integer, jsonb, jsonb)
  from public, anon;
revoke all on function public.get_quote_document(uuid, uuid) from public, anon;
revoke all on function public.soft_delete_quote_draft(uuid, uuid, integer)
  from public, anon;

grant execute on function public.create_quote_draft(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.save_quote_draft(uuid, uuid, integer, jsonb, jsonb)
  to authenticated;
grant execute on function public.get_quote_document(uuid, uuid) to authenticated;
grant execute on function public.soft_delete_quote_draft(uuid, uuid, integer)
  to authenticated;

revoke all on function private.validate_quote_party_refs() from public, anon, authenticated;
revoke all on function private.protect_quote_draft_columns() from public, anon, authenticated;
revoke all on function private.protect_quote_line_direct_writes()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------------

alter table public.quotes enable row level security;
alter table public.quote_lines enable row level security;

create policy quotes_select_member
on public.quotes
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
);

-- Mutations go through security-definer RPCs; no insert/update/delete policies.

create policy quote_lines_select_member
on public.quote_lines
for select
to authenticated
using (
  private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
  and exists (
    select 1
    from public.quotes
    where quotes.id = quote_lines.quote_id
      and quotes.org_id = quote_lines.org_id
      and quotes.deleted_at is null
  )
);

revoke all on table public.quotes from public, anon, authenticated;
revoke all on table public.quote_lines from public, anon, authenticated;

grant select on table public.quotes to authenticated;
grant select on table public.quote_lines to authenticated;

-- ---------------------------------------------------------------------------
-- Test-only loopback dblink helper
-- Supabase's postgres role is not a superuser, so contrib dblink rejects
-- non-superuser connects even with password-bearing connstrings in CI.
-- This SECURITY DEFINER wrapper runs as the migration owner (superuser) and
-- only accepts local loopback URIs when app.allow_test_dblink=on.
-- ---------------------------------------------------------------------------
create extension if not exists dblink with schema extensions;

-- Extension owner (migration role) can grant the unrestricted connect helper.
grant execute on function extensions.dblink_connect_u(text, text) to postgres;

create or replace function private.test_dblink_connect(
  p_name text,
  p_connstr text
)
returns void
language plpgsql
security definer
set search_path = extensions, pg_catalog
as $$
begin
  if current_setting('app.allow_test_dblink', true) is distinct from 'on' then
    raise exception 'test dblink connect is disabled'
      using errcode = '42501';
  end if;

  if p_name is null or p_name !~ '^[A-Za-z0-9_]+$' then
    raise exception 'invalid dblink connection name'
      using errcode = '22023';
  end if;

  if p_connstr is null
    or p_connstr !~ '^postgresql://postgres:postgres@127\.0\.0\.1:[0-9]+/[A-Za-z0-9_]+$'
  then
    raise exception 'test dblink only allows local postgres loopback URIs'
      using errcode = '42501';
  end if;

  -- dblink_connect still rejects non-superusers when auth is trust/peer even
  -- with a password in the URI; connect_u is required on Supabase local.
  perform dblink_connect_u(p_name, p_connstr);
end;
$$;

revoke all on function private.test_dblink_connect(text, text)
  from public, anon, authenticated;
grant execute on function private.test_dblink_connect(text, text) to postgres;

-- Per-client VAT exemption: skip product/org default tax when tax_rate_percent is omitted.
-- Explicit tax_rate_percent (including 0) still wins.

alter table public.clients
  add column if not exists tax_exempt boolean not null default false;

comment on column public.clients.tax_exempt is
  'When true, omitted line tax on quotes/invoices/recurring defaults to 0 instead of product/org rates.';

drop function if exists private.resolve_document_line_tax_rate(uuid, jsonb, uuid) cascade;

create or replace function private.resolve_document_line_tax_rate(
  p_org_id uuid,
  p_line jsonb,
  p_product_tax_rate_id uuid default null,
  p_client_tax_exempt boolean default false
)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rate numeric;
begin
  -- Explicit override wins, including tax_rate_percent: 0 (zero-rated).
  if p_line ? 'tax_rate_percent' and p_line ->> 'tax_rate_percent' is not null then
    return (p_line ->> 'tax_rate_percent')::numeric;
  end if;

  -- Client VAT exemption skips product and org defaults when tax is omitted.
  if coalesce(p_client_tax_exempt, false) then
    return 0;
  end if;

  if p_product_tax_rate_id is not null then
    select tax_rates.rate_percent
      into rate
    from public.tax_rates
    where tax_rates.id = p_product_tax_rate_id
      and tax_rates.org_id = p_org_id
      and tax_rates.deleted_at is null
      and tax_rates.active;

    if found then
      return rate;
    end if;
  end if;

  return private.org_default_tax_rate_percent(p_org_id);
end;
$$;

revoke all on function private.resolve_document_line_tax_rate(uuid, jsonb, uuid, boolean)
  from public, anon, authenticated;

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
  client_tax_exempt boolean := false;
begin
  select coalesce(clients.tax_exempt, false)
    into client_tax_exempt
  from public.quotes
  left join public.clients
    on clients.id = quotes.client_id
   and clients.org_id = p_org_id
   and clients.deleted_at is null
  where quotes.id = p_quote_id
    and quotes.org_id = p_org_id;

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

      line_tax_rate := private.resolve_document_line_tax_rate(
        p_org_id,
        line_item,
        product_row.tax_rate_id,
        client_tax_exempt
      );
    else
      if line_item ->> 'unit_price_cents' is null then
        raise exception 'Free-text quote lines require unit_price_cents'
          using errcode = '22023';
      end if;
      line_unit_price := (line_item ->> 'unit_price_cents')::bigint;
      line_tax_rate := private.resolve_document_line_tax_rate(
        p_org_id,
        line_item,
        null,
        client_tax_exempt
      );
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
  client_tax_exempt boolean := false;
begin
  select coalesce(clients.tax_exempt, false)
    into client_tax_exempt
  from public.invoices
  left join public.clients
    on clients.id = invoices.client_id
   and clients.org_id = p_org_id
   and clients.deleted_at is null
  where invoices.id = p_invoice_id
    and invoices.org_id = p_org_id;

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

      line_tax_rate := private.resolve_document_line_tax_rate(
        p_org_id,
        line_item,
        product_row.tax_rate_id,
        client_tax_exempt
      );
    else
      if line_item ->> 'unit_price_cents' is null then
        raise exception 'Free-text invoice lines require unit_price_cents'
          using errcode = '22023';
      end if;
      line_unit_price := (line_item ->> 'unit_price_cents')::bigint;
      line_tax_rate := private.resolve_document_line_tax_rate(
        p_org_id,
        line_item,
        null,
        client_tax_exempt
      );
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

      line_tax_rate := private.resolve_document_line_tax_rate(
        p_org_id,
        line_item,
        product_row.tax_rate_id
      );
    else
      if line_item ->> 'unit_price_cents' is null then
        raise exception 'Free-text bill lines require unit_price_cents'
          using errcode = '22023';
      end if;
      line_unit_price := (line_item ->> 'unit_price_cents')::bigint;
      line_tax_rate := private.resolve_document_line_tax_rate(
        p_org_id,
        line_item,
        null
      );
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

create or replace function private.replace_recurring_schedule_lines(
  p_org_id uuid,
  p_schedule_id uuid,
  p_actor_id uuid,
  p_lines jsonb,
  p_schedule_currency char(3)
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  line_item jsonb;
  line_index integer := 0;
  product_row public.products;
  line_product_id uuid;
  line_description text;
  line_sku text;
  line_quantity numeric(14, 4);
  line_unit_price bigint;
  line_discount numeric(7, 4);
  line_tax_rate numeric(7, 4);
  line_position integer;
  line_active boolean;
  count_inserted integer := 0;
  client_tax_exempt boolean := false;
begin
  select coalesce(clients.tax_exempt, false)
    into client_tax_exempt
  from public.recurring_invoice_schedules
  left join public.clients
    on clients.id = recurring_invoice_schedules.client_id
   and clients.org_id = p_org_id
   and clients.deleted_at is null
  where recurring_invoice_schedules.id = p_schedule_id
    and recurring_invoice_schedules.org_id = p_org_id;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Recurring schedule lines must be an array'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_lines) > 200 then
    raise exception 'Recurring schedule cannot exceed 200 lines'
      using errcode = '22023';
  end if;

  delete from public.recurring_invoice_lines
  where recurring_invoice_lines.schedule_id = p_schedule_id
    and recurring_invoice_lines.org_id = p_org_id;

  for line_item in
    select value
    from jsonb_array_elements(p_lines) with ordinality as t(value, ord)
    order by ord
  loop
    line_product_id := nullif(line_item ->> 'product_id', '')::uuid;
    line_description := nullif(trim(coalesce(
      line_item ->> 'description_template',
      line_item ->> 'description',
      ''
    )), '');
    line_sku := null;
    line_quantity := (line_item ->> 'quantity')::numeric;
    line_discount := coalesce((line_item ->> 'discount_percent')::numeric, 0);
    line_position := coalesce((line_item ->> 'position')::integer, line_index);
    line_active := coalesce((line_item ->> 'active')::boolean, true);

    if line_quantity is null
      or lower(line_quantity::text) in ('nan', 'infinity', '-infinity')
      or line_quantity <= 0
    then
      raise exception 'Recurring line quantity must be greater than zero'
        using errcode = '22023';
    end if;

    if line_discount < 0 or line_discount > 100 then
      raise exception 'Recurring line discount_percent must be between 0 and 100'
        using errcode = '22023';
    end if;

    if line_position < 0 then
      raise exception 'Recurring line position must be non-negative'
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
        raise exception 'Recurring line product must be an active product in the same organisation'
          using errcode = '22023';
      end if;

      if product_row.currency is distinct from p_schedule_currency then
        raise exception 'Recurring line product currency must match schedule currency'
          using errcode = '22023';
      end if;

      line_sku := product_row.sku;
      line_description := coalesce(line_description, product_row.name);
      line_unit_price := coalesce(
        nullif(line_item ->> 'unit_price_cents', '')::bigint,
        product_row.unit_price_cents
      );

      line_tax_rate := private.resolve_document_line_tax_rate(
        p_org_id,
        line_item,
        product_row.tax_rate_id,
        client_tax_exempt
      );
    else
      if line_item ->> 'unit_price_cents' is null then
        raise exception 'Free-text recurring lines require unit_price_cents'
          using errcode = '22023';
      end if;
      line_unit_price := (line_item ->> 'unit_price_cents')::bigint;
      line_tax_rate := private.resolve_document_line_tax_rate(
        p_org_id,
        line_item,
        null,
        client_tax_exempt
      );
    end if;

    if line_description is null or char_length(line_description) > 200 then
      raise exception 'Recurring line description_template must be between 1 and 200 characters'
        using errcode = '22023';
    end if;

    if line_unit_price is null or line_unit_price < 0 then
      raise exception 'Recurring line unit_price_cents must be a non-negative integer'
        using errcode = '22023';
    end if;

    if line_tax_rate < 0 or line_tax_rate > 100 then
      raise exception 'Recurring line tax_rate_percent must be between 0 and 100'
        using errcode = '22023';
    end if;

    insert into public.recurring_invoice_lines (
      org_id, schedule_id, product_id, sku_snapshot, description_template,
      quantity, unit_price_cents, discount_percent, tax_rate_percent,
      position, active, created_by, updated_by
    ) values (
      p_org_id, p_schedule_id, line_product_id, line_sku, line_description,
      line_quantity, line_unit_price, line_discount, line_tax_rate,
      line_position, line_active, p_actor_id, p_actor_id
    );

    count_inserted := count_inserted + 1;
    line_index := line_index + 1;
  end loop;

  return count_inserted;
end;
$$;

revoke all on function private.replace_quote_lines(uuid, uuid, uuid, jsonb, char)
  from public, anon, authenticated;

revoke all on function private.replace_invoice_lines(uuid, uuid, uuid, jsonb, char)
  from public, anon, authenticated;

revoke all on function private.replace_bill_lines(uuid, uuid, uuid, jsonb, char)
  from public, anon, authenticated;

revoke all on function private.replace_recurring_schedule_lines(uuid, uuid, uuid, jsonb, char)
  from public, anon, authenticated;

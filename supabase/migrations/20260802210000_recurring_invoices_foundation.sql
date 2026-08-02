-- Recurring invoices foundation: schedules, lines, runs + lifecycle/run-now RPCs.
-- Dictionary §6.6–6.8; PLANS/RECURRING_INVOICES_FOUNDATION_SLICE.md.
-- No cron/outbox/auto-send execution in this slice.

set search_path = public, extensions, pg_catalog;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.recurring_invoice_schedules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  name text not null check (char_length(name) between 1 and 200),
  client_id uuid not null,
  contact_id uuid,
  owner_membership_id uuid,
  status text not null default 'draft',
  currency char(3) not null,
  frequency text not null,
  interval_count smallint not null default 1 check (interval_count > 0),
  anchor_on date not null,
  rule_version integer not null default 1 check (rule_version > 0),
  weekdays smallint[],
  day_of_month smallint,
  month_of_year smallint,
  month_end_policy text not null default 'clamp',
  timezone text not null default 'UTC',
  local_run_time time not null default time '09:00:00',
  start_on date not null,
  end_on date,
  max_occurrences integer,
  scheduled_occurrence_count integer not null default 0 check (scheduled_occurrence_count >= 0),
  next_run_at timestamptz,
  last_run_at timestamptz,
  due_days smallint not null default 14 check (due_days >= 0 and due_days <= 3650),
  delivery_mode text not null default 'draft',
  pricing_mode text not null default 'fixed',
  catch_up_policy text not null default 'latest',
  max_catch_up_runs smallint not null default 1 check (max_catch_up_runs > 0 and max_catch_up_runs <= 31),
  purchase_order_number text,
  payment_terms text,
  notes text,
  internal_notes text,
  activated_at timestamptz,
  paused_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete set null,
  constraint recurring_invoice_schedules_org_id_id_key unique (org_id, id),
  constraint recurring_invoice_schedules_client_fk
    foreign key (org_id, client_id)
    references public.clients (org_id, id),
  constraint recurring_invoice_schedules_contact_fk
    foreign key (org_id, contact_id)
    references public.contacts (org_id, id)
    on delete set null (contact_id),
  constraint recurring_invoice_schedules_owner_membership_fk
    foreign key (org_id, owner_membership_id)
    references public.memberships (org_id, id)
    on delete set null (owner_membership_id),
  constraint recurring_invoice_schedules_status_check
    check (status in ('draft', 'active', 'paused', 'completed', 'cancelled')),
  constraint recurring_invoice_schedules_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint recurring_invoice_schedules_frequency_check
    check (frequency in ('daily', 'weekly', 'monthly', 'yearly')),
  constraint recurring_invoice_schedules_month_end_policy_check
    check (month_end_policy in ('clamp', 'last_day', 'skip')),
  constraint recurring_invoice_schedules_delivery_mode_check
    check (delivery_mode in ('draft', 'auto_send')),
  constraint recurring_invoice_schedules_pricing_mode_check
    check (pricing_mode in ('fixed', 'catalog_at_generation')),
  constraint recurring_invoice_schedules_catch_up_policy_check
    check (catch_up_policy in ('skip', 'latest', 'all')),
  constraint recurring_invoice_schedules_timezone_check
    check (char_length(timezone) between 1 and 64),
  constraint recurring_invoice_schedules_end_on_check
    check (end_on is null or end_on >= start_on),
  constraint recurring_invoice_schedules_max_occurrences_check
    check (max_occurrences is null or max_occurrences > 0),
  constraint recurring_invoice_schedules_day_of_month_check
    check (day_of_month is null or (day_of_month between 1 and 31)),
  constraint recurring_invoice_schedules_month_of_year_check
    check (month_of_year is null or (month_of_year between 1 and 12)),
  constraint recurring_invoice_schedules_weekdays_check
    check (
      weekdays is null
      or (
        cardinality(weekdays) > 0
        and weekdays <@ array[1,2,3,4,5,6,7]::smallint[]
      )
    ),
  constraint recurring_invoice_schedules_frequency_fields_check
    check (
      (frequency = 'daily' and weekdays is null and day_of_month is null and month_of_year is null)
      or (frequency = 'weekly' and weekdays is not null and day_of_month is null and month_of_year is null)
      or (frequency = 'monthly' and day_of_month is not null and weekdays is null and month_of_year is null)
      or (frequency = 'yearly' and day_of_month is not null and month_of_year is not null and weekdays is null)
    ),
  constraint recurring_invoice_schedules_next_run_active_check
    check (
      (status = 'active' and next_run_at is not null)
      or (status <> 'active' and next_run_at is null)
    ),
  constraint recurring_invoice_schedules_purchase_order_length_check
    check (purchase_order_number is null or char_length(purchase_order_number) <= 100),
  constraint recurring_invoice_schedules_payment_terms_length_check
    check (payment_terms is null or char_length(payment_terms) <= 2000),
  constraint recurring_invoice_schedules_notes_length_check
    check (notes is null or char_length(notes) <= 20000),
  constraint recurring_invoice_schedules_internal_notes_length_check
    check (internal_notes is null or char_length(internal_notes) <= 20000)
);

create index recurring_invoice_schedules_org_created_idx
  on public.recurring_invoice_schedules (org_id, created_at desc, id desc)
  where deleted_at is null;

create index recurring_invoice_schedules_org_status_idx
  on public.recurring_invoice_schedules (org_id, status, created_at desc, id desc)
  where deleted_at is null;

create index recurring_invoice_schedules_org_next_run_idx
  on public.recurring_invoice_schedules (org_id, next_run_at, id)
  where deleted_at is null and status = 'active' and next_run_at is not null;

create index recurring_invoice_schedules_org_client_idx
  on public.recurring_invoice_schedules (org_id, client_id, created_at desc, id desc)
  where deleted_at is null;

create trigger recurring_invoice_schedules_stamp_business_row
before insert or update on public.recurring_invoice_schedules
for each row execute function private.stamp_business_row();

create table public.recurring_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  schedule_id uuid not null,
  product_id uuid,
  sku_snapshot text,
  description_template text not null check (char_length(description_template) between 1 and 200),
  quantity numeric(14, 4) not null check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  discount_percent numeric(7, 4) not null default 0
    check (discount_percent >= 0 and discount_percent <= 100),
  tax_rate_percent numeric(7, 4) not null default 0
    check (tax_rate_percent >= 0 and tax_rate_percent <= 100),
  position integer not null check (position >= 0),
  active boolean not null default true,
  constraint recurring_invoice_lines_org_id_id_key unique (org_id, id),
  constraint recurring_invoice_lines_schedule_fk
    foreign key (org_id, schedule_id)
    references public.recurring_invoice_schedules (org_id, id)
    on delete cascade,
  constraint recurring_invoice_lines_product_fk
    foreign key (org_id, product_id)
    references public.products (org_id, id)
    on delete set null (product_id),
  constraint recurring_invoice_lines_schedule_position_key
    unique (schedule_id, position)
);

create index recurring_invoice_lines_schedule_idx
  on public.recurring_invoice_lines (org_id, schedule_id, position, id)
  where deleted_at is null;

create trigger recurring_invoice_lines_stamp_business_row
before insert or update on public.recurring_invoice_lines
for each row execute function private.stamp_business_row();

create table public.recurring_invoice_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  schedule_id uuid not null,
  occurrence_sequence bigint,
  occurrence_key text not null check (char_length(occurrence_key) between 1 and 200),
  scheduled_for timestamptz not null,
  occurrence_local_date date not null,
  occurrence_timezone text not null check (char_length(occurrence_timezone) between 1 and 64),
  schedule_version integer not null check (schedule_version > 0),
  configuration_snapshot jsonb not null,
  period_start date not null,
  period_end date not null,
  trigger text not null,
  status text not null default 'pending',
  attempt_count smallint not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by text,
  lease_expires_at timestamptz,
  generated_at timestamptz,
  sent_at timestamptz,
  error_code text,
  error_message text,
  request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_invoice_runs_org_id_id_key unique (org_id, id),
  constraint recurring_invoice_runs_schedule_fk
    foreign key (org_id, schedule_id)
    references public.recurring_invoice_schedules (org_id, id)
    on delete cascade,
  constraint recurring_invoice_runs_schedule_occurrence_key_key
    unique (schedule_id, occurrence_key),
  constraint recurring_invoice_runs_schedule_occurrence_sequence_key
    unique (schedule_id, occurrence_sequence),
  constraint recurring_invoice_runs_trigger_check
    check (trigger in ('scheduled', 'manual', 'catch_up')),
  constraint recurring_invoice_runs_status_check
    check (status in (
      'pending', 'processing', 'generated', 'delivery_pending', 'sent',
      'skipped', 'generation_failed', 'delivery_failed', 'delivery_unknown'
    )),
  constraint recurring_invoice_runs_configuration_snapshot_object_check
    check (jsonb_typeof(configuration_snapshot) = 'object'),
  constraint recurring_invoice_runs_period_check
    check (period_end >= period_start)
);

create index recurring_invoice_runs_org_schedule_created_idx
  on public.recurring_invoice_runs (org_id, schedule_id, created_at desc, id desc);

create index recurring_invoice_runs_org_status_available_idx
  on public.recurring_invoice_runs (org_id, status, available_at, id);

create trigger recurring_invoice_runs_set_updated_at
before update on public.recurring_invoice_runs
for each row execute function private.set_updated_at();

-- Wire invoices.recurring_run_id → runs (org-safe)
alter table public.invoices
  add constraint invoices_recurring_run_fk
  foreign key (org_id, recurring_run_id)
  references public.recurring_invoice_runs (org_id, id)
  on delete set null (recurring_run_id);


-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function private.recurring_clamp_month_day(
  p_year integer,
  p_month integer,
  p_day integer,
  p_policy text
)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  last_day integer;
begin
  if p_month < 1 or p_month > 12 or p_day is null then
    return null;
  end if;
  last_day := extract(
    day from (
      (make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date
    )
  )::integer;

  if p_policy = 'last_day' then
    return make_date(p_year, p_month, last_day);
  end if;

  if p_day > last_day then
    if p_policy = 'skip' then
      return null;
    end if;
    -- clamp
    return make_date(p_year, p_month, last_day);
  end if;

  return make_date(p_year, p_month, p_day);
end;
$$;

revoke all on function private.recurring_clamp_month_day(integer, integer, integer, text)
  from public, anon, authenticated;

create or replace function private.compute_recurring_next_run_at(
  p_frequency text,
  p_interval_count smallint,
  p_anchor_on date,
  p_start_on date,
  p_end_on date,
  p_timezone text,
  p_local_run_time time,
  p_day_of_month smallint,
  p_weekdays smallint[],
  p_month_of_year smallint,
  p_month_end_policy text,
  p_from timestamptz default now()
)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  tz text := coalesce(nullif(trim(p_timezone), ''), 'UTC');
  local_now timestamp;
  local_today date;
  cand date;
  ts timestamptz;
  month_start date;
  y integer;
  m integer;
  weeks integer;
begin
  begin
    local_now := (p_from at time zone tz);
  exception
    when others then
      raise exception 'Invalid timezone %', tz
        using errcode = '22023';
  end;

  local_today := local_now::date;
  cand := greatest(p_start_on, p_anchor_on, local_today);

  -- Generic day walk with frequency filters (bounded).
  cand := greatest(p_start_on, local_today);
  if cand < p_anchor_on then
    cand := p_anchor_on;
  end if;

  for i in 0..1200 loop
    if p_end_on is not null and cand > p_end_on then
      return null;
    end if;

    if p_frequency = 'daily' then
      if ((cand - p_anchor_on) % p_interval_count) = 0 and cand >= p_start_on then
        ts := ((cand + p_local_run_time) at time zone tz);
        if ts > p_from then
          return ts;
        end if;
      end if;
    elsif p_frequency = 'weekly' then
      if p_weekdays is not null
        and (extract(isodow from cand)::smallint = any (p_weekdays))
        and cand >= p_start_on
      then
        weeks := ((cand - p_anchor_on) / 7);
        if weeks >= 0 and (weeks % p_interval_count) = 0 then
          ts := ((cand + p_local_run_time) at time zone tz);
          if ts > p_from then
            return ts;
          end if;
        end if;
      end if;
    elsif p_frequency = 'monthly' then
      month_start := date_trunc('month', p_anchor_on)::date;
      -- Accept cand if it matches a clamped day for some interval month
      if cand >= p_start_on then
        y := extract(year from cand)::integer;
        m := extract(month from cand)::integer;
        if (
          (
            (y * 12 + m)
            - (extract(year from month_start)::integer * 12
              + extract(month from month_start)::integer)
          ) % p_interval_count
        ) = 0 then
          if private.recurring_clamp_month_day(y, m, p_day_of_month, p_month_end_policy) = cand then
            ts := ((cand + p_local_run_time) at time zone tz);
            if ts > p_from then
              return ts;
            end if;
          end if;
        end if;
      end if;
    elsif p_frequency = 'yearly' then
      if cand >= p_start_on
        and extract(month from cand)::integer = p_month_of_year
        and (
          (extract(year from cand)::integer - extract(year from p_anchor_on)::integer)
          % p_interval_count
        ) = 0
      then
        if private.recurring_clamp_month_day(
          extract(year from cand)::integer,
          p_month_of_year,
          p_day_of_month,
          p_month_end_policy
        ) = cand then
          ts := ((cand + p_local_run_time) at time zone tz);
          if ts > p_from then
            return ts;
          end if;
        end if;
      end if;
    end if;

    cand := cand + 1;
  end loop;

  return null;
end;
$$;

revoke all on function private.compute_recurring_next_run_at(
  text, smallint, date, date, date, text, time, smallint, smallint[], smallint, text, timestamptz
) from public, anon, authenticated;

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
  tax_row public.tax_rates;
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
begin
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
        raise exception 'Free-text recurring lines require unit_price_cents'
          using errcode = '22023';
      end if;
      line_unit_price := (line_item ->> 'unit_price_cents')::bigint;
      line_tax_rate := coalesce((line_item ->> 'tax_rate_percent')::numeric, 0);
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

revoke all on function private.replace_recurring_schedule_lines(uuid, uuid, uuid, jsonb, char)
  from public, anon, authenticated;

create or replace function private.recurring_schedule_document(
  p_schedule_id uuid,
  p_org_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  schedule_row public.recurring_invoice_schedules;
  lines_json jsonb;
begin
  select * into schedule_row
  from public.recurring_invoice_schedules
  where recurring_invoice_schedules.id = p_schedule_id
    and recurring_invoice_schedules.org_id = p_org_id
    and recurring_invoice_schedules.deleted_at is null;

  if not found then
    return null;
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(recurring_invoice_lines) order by recurring_invoice_lines.position, recurring_invoice_lines.id),
    '[]'::jsonb
  )
  into lines_json
  from public.recurring_invoice_lines
  where recurring_invoice_lines.schedule_id = schedule_row.id
    and recurring_invoice_lines.org_id = p_org_id
    and recurring_invoice_lines.deleted_at is null;

  return jsonb_build_object(
    'schedule', to_jsonb(schedule_row),
    'lines', lines_json
  );
end;
$$;

revoke all on function private.recurring_schedule_document(uuid, uuid)
  from public, anon, authenticated;

create or replace function private.estimate_recurring_line_totals(
  p_org_id uuid,
  p_schedule_id uuid
)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  line_row public.recurring_invoice_lines;
  amounts record;
  total bigint := 0;
begin
  for line_row in
    select *
    from public.recurring_invoice_lines
    where schedule_id = p_schedule_id
      and org_id = p_org_id
      and deleted_at is null
      and active
    order by position, id
  loop
    select * into amounts
    from private.calculate_quote_line_amounts(
      line_row.quantity,
      line_row.unit_price_cents,
      line_row.discount_percent,
      line_row.tax_rate_percent
    );
    total := total + amounts.total_cents;
  end loop;
  return total;
end;
$$;

revoke all on function private.estimate_recurring_line_totals(uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public RPCs: CRUD + lifecycle + preview + run-now
-- ---------------------------------------------------------------------------

create or replace function public.create_recurring_schedule_draft(
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
  schedule_row public.recurring_invoice_schedules;
  org_currency char(3);
  org_tz text;
  v_name text;
  v_client_id uuid;
  v_contact_id uuid;
  v_owner_membership_id uuid;
  v_currency char(3);
  v_frequency text;
  v_interval_count smallint;
  v_anchor_on date;
  v_weekdays smallint[];
  v_day_of_month smallint;
  v_month_of_year smallint;
  v_month_end_policy text;
  v_timezone text;
  v_local_run_time time;
  v_start_on date;
  v_end_on date;
  v_max_occurrences integer;
  v_due_days smallint;
  v_delivery_mode text;
  v_pricing_mode text;
  v_catch_up_policy text;
  v_max_catch_up_runs smallint;
  v_purchase_order_number text;
  v_payment_terms text;
  v_notes text;
  v_internal_notes text;
  wd jsonb;
  elem text;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Schedule payload must be an object' using errcode = '22023';
  end if;

  select organisations.default_currency, organisations.timezone
  into org_currency, org_tz
  from public.organisations
  where organisations.id = p_org_id and organisations.deleted_at is null;
  if not found then
    raise exception 'Organisation not found' using errcode = 'P0002';
  end if;

  v_name := nullif(trim(coalesce(p_payload ->> 'name', '')), '');
  if v_name is null or char_length(v_name) > 200 then
    raise exception 'Schedule name must be between 1 and 200 characters' using errcode = '22023';
  end if;

  v_client_id := nullif(p_payload ->> 'client_id', '')::uuid;
  if v_client_id is null then
    raise exception 'Schedule requires client_id' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.clients
    where clients.id = v_client_id and clients.org_id = p_org_id and clients.deleted_at is null
  ) then
    raise exception 'Schedule client not found in organisation' using errcode = '22023';
  end if;

  v_contact_id := nullif(p_payload ->> 'contact_id', '')::uuid;
  if v_contact_id is not null and not exists (
    select 1 from public.contacts
    where contacts.id = v_contact_id and contacts.org_id = p_org_id and contacts.deleted_at is null
  ) then
    raise exception 'Schedule contact not found in organisation' using errcode = '22023';
  end if;

  v_owner_membership_id := nullif(p_payload ->> 'owner_membership_id', '')::uuid;
  v_currency := upper(coalesce(nullif(trim(p_payload ->> 'currency'), ''), org_currency))::char(3);
  v_frequency := lower(nullif(trim(p_payload ->> 'frequency'), ''));
  if v_frequency is null or v_frequency not in ('daily', 'weekly', 'monthly', 'yearly') then
    raise exception 'Schedule frequency must be daily, weekly, monthly, or yearly' using errcode = '22023';
  end if;
  v_interval_count := coalesce((p_payload ->> 'interval_count')::smallint, 1);
  v_start_on := coalesce((p_payload ->> 'start_on')::date, (timezone('utc', now()))::date);
  v_anchor_on := coalesce((p_payload ->> 'anchor_on')::date, v_start_on);
  v_end_on := nullif(p_payload ->> 'end_on', '')::date;
  v_max_occurrences := nullif(p_payload ->> 'max_occurrences', '')::integer;
  v_timezone := coalesce(nullif(trim(p_payload ->> 'timezone'), ''), org_tz, 'UTC');
  v_local_run_time := coalesce((p_payload ->> 'local_run_time')::time, time '09:00:00');
  v_due_days := coalesce((p_payload ->> 'due_days')::smallint, 14);
  v_month_end_policy := coalesce(nullif(trim(p_payload ->> 'month_end_policy'), ''), 'clamp');
  v_delivery_mode := coalesce(nullif(trim(p_payload ->> 'delivery_mode'), ''), 'draft');
  v_pricing_mode := coalesce(nullif(trim(p_payload ->> 'pricing_mode'), ''), 'fixed');
  v_catch_up_policy := coalesce(nullif(trim(p_payload ->> 'catch_up_policy'), ''), 'latest');
  v_max_catch_up_runs := coalesce((p_payload ->> 'max_catch_up_runs')::smallint, 1);
  v_purchase_order_number := nullif(trim(coalesce(p_payload ->> 'purchase_order_number', '')), '');
  v_payment_terms := nullif(trim(coalesce(p_payload ->> 'payment_terms', '')), '');
  v_notes := nullif(trim(coalesce(p_payload ->> 'notes', '')), '');
  v_internal_notes := nullif(trim(coalesce(p_payload ->> 'internal_notes', '')), '');

  if v_frequency = 'weekly' then
    wd := p_payload -> 'weekdays';
    if wd is null or jsonb_typeof(wd) <> 'array' or jsonb_array_length(wd) < 1 then
      raise exception 'Weekly schedules require weekdays' using errcode = '22023';
    end if;
    v_weekdays := array[]::smallint[];
    for elem in select jsonb_array_elements_text(wd) loop
      v_weekdays := array_append(v_weekdays, elem::smallint);
    end loop;
  elsif v_frequency = 'monthly' then
    v_day_of_month := coalesce(
      (p_payload ->> 'day_of_month')::smallint,
      extract(day from v_anchor_on)::smallint
    );
  elsif v_frequency = 'yearly' then
    v_day_of_month := coalesce(
      (p_payload ->> 'day_of_month')::smallint,
      extract(day from v_anchor_on)::smallint
    );
    v_month_of_year := coalesce(
      (p_payload ->> 'month_of_year')::smallint,
      extract(month from v_anchor_on)::smallint
    );
  end if;

  insert into public.recurring_invoice_schedules (
    org_id, name, client_id, contact_id, owner_membership_id, status, currency,
    frequency, interval_count, anchor_on, weekdays, day_of_month, month_of_year,
    month_end_policy, timezone, local_run_time, start_on, end_on, max_occurrences,
    due_days, delivery_mode, pricing_mode, catch_up_policy, max_catch_up_runs,
    purchase_order_number, payment_terms, notes, internal_notes,
    created_by, updated_by
  ) values (
    p_org_id, v_name, v_client_id, v_contact_id, v_owner_membership_id, 'draft', v_currency,
    v_frequency, v_interval_count, v_anchor_on, v_weekdays, v_day_of_month, v_month_of_year,
    v_month_end_policy, v_timezone, v_local_run_time, v_start_on, v_end_on, v_max_occurrences,
    v_due_days, v_delivery_mode, v_pricing_mode, v_catch_up_policy, v_max_catch_up_runs,
    v_purchase_order_number, v_payment_terms, v_notes, v_internal_notes,
    actor_id, actor_id
  )
  returning * into schedule_row;

  perform private.replace_recurring_schedule_lines(
    p_org_id, schedule_row.id, actor_id, coalesce(p_lines, '[]'::jsonb), v_currency
  );

  return private.recurring_schedule_document(schedule_row.id, p_org_id);
end;
$$;

revoke all on function public.create_recurring_schedule_draft(uuid, jsonb, jsonb)
  from public, anon;
grant execute on function public.create_recurring_schedule_draft(uuid, jsonb, jsonb)
  to authenticated;

create or replace function public.get_recurring_schedule_document(
  p_schedule_id uuid,
  p_org_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  doc jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not private.has_org_role(
    p_org_id, array['owner', 'admin', 'member', 'billing', 'readonly']
  ) then
    raise exception 'This action is not permitted' using errcode = '42501';
  end if;

  doc := private.recurring_schedule_document(p_schedule_id, p_org_id);
  if doc is null then
    raise exception 'Recurring schedule not found' using errcode = 'P0002';
  end if;
  return doc;
end;
$$;

revoke all on function public.get_recurring_schedule_document(uuid, uuid) from public, anon;
grant execute on function public.get_recurring_schedule_document(uuid, uuid) to authenticated;

create or replace function public.save_recurring_schedule_draft(
  p_schedule_id uuid,
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
  schedule_row public.recurring_invoice_schedules;
  wd jsonb;
  elem text;
  v_weekdays smallint[];
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Schedule payload must be an object' using errcode = '22023';
  end if;

  select * into schedule_row
  from public.recurring_invoice_schedules
  where id = p_schedule_id and org_id = p_org_id and deleted_at is null
  for update;

  if not found then
    raise exception 'Recurring schedule not found' using errcode = 'P0002';
  end if;
  if schedule_row.version is distinct from p_expected_version then
    raise exception 'Recurring schedule version conflict' using errcode = 'P0001';
  end if;
  if schedule_row.status <> 'draft' then
    raise exception 'Only draft recurring schedules can be edited'
      using errcode = '22023';
  end if;

  if p_payload ? 'name' then
    schedule_row.name := nullif(trim(coalesce(p_payload ->> 'name', '')), '');
    if schedule_row.name is null then
      raise exception 'Schedule name must be between 1 and 200 characters' using errcode = '22023';
    end if;
  end if;
  if p_payload ? 'client_id' then
    schedule_row.client_id := nullif(p_payload ->> 'client_id', '')::uuid;
    if schedule_row.client_id is null or not exists (
      select 1 from public.clients
      where clients.id = schedule_row.client_id and clients.org_id = p_org_id and clients.deleted_at is null
    ) then
      raise exception 'Schedule client not found in organisation' using errcode = '22023';
    end if;
  end if;
  if p_payload ? 'contact_id' then
    schedule_row.contact_id := nullif(p_payload ->> 'contact_id', '')::uuid;
  end if;
  if p_payload ? 'owner_membership_id' then
    schedule_row.owner_membership_id := nullif(p_payload ->> 'owner_membership_id', '')::uuid;
  end if;
  if p_payload ? 'currency' then
    schedule_row.currency := upper(trim(p_payload ->> 'currency'))::char(3);
  end if;
  if p_payload ? 'frequency' then
    schedule_row.frequency := lower(trim(p_payload ->> 'frequency'));
  end if;
  if p_payload ? 'interval_count' then
    schedule_row.interval_count := (p_payload ->> 'interval_count')::smallint;
  end if;
  if p_payload ? 'start_on' then
    schedule_row.start_on := (p_payload ->> 'start_on')::date;
  end if;
  if p_payload ? 'anchor_on' then
    schedule_row.anchor_on := (p_payload ->> 'anchor_on')::date;
  end if;
  if p_payload ? 'end_on' then
    schedule_row.end_on := nullif(p_payload ->> 'end_on', '')::date;
  end if;
  if p_payload ? 'max_occurrences' then
    schedule_row.max_occurrences := nullif(p_payload ->> 'max_occurrences', '')::integer;
  end if;
  if p_payload ? 'timezone' then
    schedule_row.timezone := coalesce(nullif(trim(p_payload ->> 'timezone'), ''), schedule_row.timezone);
  end if;
  if p_payload ? 'local_run_time' then
    schedule_row.local_run_time := coalesce((p_payload ->> 'local_run_time')::time, schedule_row.local_run_time);
  end if;
  if p_payload ? 'due_days' then
    schedule_row.due_days := (p_payload ->> 'due_days')::smallint;
  end if;
  if p_payload ? 'month_end_policy' then
    schedule_row.month_end_policy := trim(p_payload ->> 'month_end_policy');
  end if;
  if p_payload ? 'delivery_mode' then
    schedule_row.delivery_mode := trim(p_payload ->> 'delivery_mode');
  end if;
  if p_payload ? 'pricing_mode' then
    schedule_row.pricing_mode := trim(p_payload ->> 'pricing_mode');
  end if;
  if p_payload ? 'catch_up_policy' then
    schedule_row.catch_up_policy := trim(p_payload ->> 'catch_up_policy');
  end if;
  if p_payload ? 'max_catch_up_runs' then
    schedule_row.max_catch_up_runs := (p_payload ->> 'max_catch_up_runs')::smallint;
  end if;
  if p_payload ? 'purchase_order_number' then
    schedule_row.purchase_order_number := nullif(trim(coalesce(p_payload ->> 'purchase_order_number', '')), '');
  end if;
  if p_payload ? 'payment_terms' then
    schedule_row.payment_terms := nullif(trim(coalesce(p_payload ->> 'payment_terms', '')), '');
  end if;
  if p_payload ? 'notes' then
    schedule_row.notes := nullif(trim(coalesce(p_payload ->> 'notes', '')), '');
  end if;
  if p_payload ? 'internal_notes' then
    schedule_row.internal_notes := nullif(trim(coalesce(p_payload ->> 'internal_notes', '')), '');
  end if;

  -- Normalize frequency-specific fields after possible frequency change
  if schedule_row.frequency = 'daily' then
    schedule_row.weekdays := null;
    schedule_row.day_of_month := null;
    schedule_row.month_of_year := null;
  elsif schedule_row.frequency = 'weekly' then
    schedule_row.day_of_month := null;
    schedule_row.month_of_year := null;
    if p_payload ? 'weekdays' or p_payload ? 'frequency' then
      wd := coalesce(p_payload -> 'weekdays', to_jsonb(schedule_row.weekdays));
      if wd is null or jsonb_typeof(wd) <> 'array' or jsonb_array_length(wd) < 1 then
        raise exception 'Weekly schedules require weekdays' using errcode = '22023';
      end if;
      v_weekdays := array[]::smallint[];
      for elem in select jsonb_array_elements_text(wd) loop
        v_weekdays := array_append(v_weekdays, elem::smallint);
      end loop;
      schedule_row.weekdays := v_weekdays;
    end if;
  elsif schedule_row.frequency = 'monthly' then
    schedule_row.weekdays := null;
    schedule_row.month_of_year := null;
    schedule_row.day_of_month := coalesce(
      (p_payload ->> 'day_of_month')::smallint,
      schedule_row.day_of_month,
      extract(day from schedule_row.anchor_on)::smallint
    );
  elsif schedule_row.frequency = 'yearly' then
    schedule_row.weekdays := null;
    schedule_row.day_of_month := coalesce(
      (p_payload ->> 'day_of_month')::smallint,
      schedule_row.day_of_month,
      extract(day from schedule_row.anchor_on)::smallint
    );
    schedule_row.month_of_year := coalesce(
      (p_payload ->> 'month_of_year')::smallint,
      schedule_row.month_of_year,
      extract(month from schedule_row.anchor_on)::smallint
    );
  end if;

  update public.recurring_invoice_schedules
  set
    name = schedule_row.name,
    client_id = schedule_row.client_id,
    contact_id = schedule_row.contact_id,
    owner_membership_id = schedule_row.owner_membership_id,
    currency = schedule_row.currency,
    frequency = schedule_row.frequency,
    interval_count = schedule_row.interval_count,
    anchor_on = schedule_row.anchor_on,
    weekdays = schedule_row.weekdays,
    day_of_month = schedule_row.day_of_month,
    month_of_year = schedule_row.month_of_year,
    month_end_policy = schedule_row.month_end_policy,
    timezone = schedule_row.timezone,
    local_run_time = schedule_row.local_run_time,
    start_on = schedule_row.start_on,
    end_on = schedule_row.end_on,
    max_occurrences = schedule_row.max_occurrences,
    due_days = schedule_row.due_days,
    delivery_mode = schedule_row.delivery_mode,
    pricing_mode = schedule_row.pricing_mode,
    catch_up_policy = schedule_row.catch_up_policy,
    max_catch_up_runs = schedule_row.max_catch_up_runs,
    purchase_order_number = schedule_row.purchase_order_number,
    payment_terms = schedule_row.payment_terms,
    notes = schedule_row.notes,
    internal_notes = schedule_row.internal_notes,
    rule_version = schedule_row.rule_version + 1,
    updated_by = actor_id
  where id = schedule_row.id;

  if p_lines is not null then
    perform private.replace_recurring_schedule_lines(
      p_org_id, schedule_row.id, actor_id, p_lines, schedule_row.currency
    );
  end if;

  return private.recurring_schedule_document(schedule_row.id, p_org_id);
end;
$$;

revoke all on function public.save_recurring_schedule_draft(uuid, uuid, integer, jsonb, jsonb)
  from public, anon;
grant execute on function public.save_recurring_schedule_draft(uuid, uuid, integer, jsonb, jsonb)
  to authenticated;

create or replace function public.soft_delete_recurring_schedule_draft(
  p_schedule_id uuid,
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
  schedule_row public.recurring_invoice_schedules;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted' using errcode = '42501';
  end if;

  select * into schedule_row
  from public.recurring_invoice_schedules
  where id = p_schedule_id and org_id = p_org_id and deleted_at is null
  for update;

  if not found then
    raise exception 'Recurring schedule not found' using errcode = 'P0002';
  end if;
  if schedule_row.version is distinct from p_expected_version then
    raise exception 'Recurring schedule version conflict' using errcode = 'P0001';
  end if;
  if schedule_row.status <> 'draft' then
    raise exception 'Only draft recurring schedules can be deleted'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.recurring_invoice_runs
    where schedule_id = schedule_row.id and org_id = p_org_id
  ) then
    raise exception 'Cannot delete a recurring schedule that has runs'
      using errcode = '22023';
  end if;

  update public.recurring_invoice_schedules
  set deleted_at = now(), updated_by = actor_id
  where id = schedule_row.id;

  update public.recurring_invoice_lines
  set deleted_at = now(), updated_by = actor_id
  where schedule_id = schedule_row.id and org_id = p_org_id and deleted_at is null;
end;
$$;

revoke all on function public.soft_delete_recurring_schedule_draft(uuid, uuid, integer)
  from public, anon;
grant execute on function public.soft_delete_recurring_schedule_draft(uuid, uuid, integer)
  to authenticated;


create or replace function public.activate_recurring_schedule(
  p_schedule_id uuid,
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
  schedule_row public.recurring_invoice_schedules;
  next_at timestamptz;
  active_lines integer;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted' using errcode = '42501';
  end if;

  select * into schedule_row
  from public.recurring_invoice_schedules
  where id = p_schedule_id and org_id = p_org_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Recurring schedule not found' using errcode = 'P0002';
  end if;
  if schedule_row.version is distinct from p_expected_version then
    raise exception 'Recurring schedule version conflict' using errcode = 'P0001';
  end if;
  if schedule_row.status <> 'draft' then
    raise exception 'Only draft recurring schedules can be activated'
      using errcode = '22023';
  end if;

  select count(*) into active_lines
  from public.recurring_invoice_lines
  where schedule_id = schedule_row.id
    and org_id = p_org_id
    and deleted_at is null
    and active;
  if active_lines < 1 then
    raise exception 'Activation requires at least one active line'
      using errcode = '22023';
  end if;

  next_at := private.compute_recurring_next_run_at(
    schedule_row.frequency,
    schedule_row.interval_count,
    schedule_row.anchor_on,
    schedule_row.start_on,
    schedule_row.end_on,
    schedule_row.timezone,
    schedule_row.local_run_time,
    schedule_row.day_of_month,
    schedule_row.weekdays,
    schedule_row.month_of_year,
    schedule_row.month_end_policy,
    now()
  );
  if next_at is null then
    raise exception 'Could not compute next_run_at for activation'
      using errcode = '22023';
  end if;

  update public.recurring_invoice_schedules
  set
    status = 'active',
    next_run_at = next_at,
    activated_at = coalesce(activated_at, now()),
    paused_at = null,
    updated_by = actor_id
  where id = schedule_row.id;

  return private.recurring_schedule_document(schedule_row.id, p_org_id);
end;
$$;

revoke all on function public.activate_recurring_schedule(uuid, uuid, integer) from public, anon;
grant execute on function public.activate_recurring_schedule(uuid, uuid, integer) to authenticated;

create or replace function public.pause_recurring_schedule(
  p_schedule_id uuid,
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
  schedule_row public.recurring_invoice_schedules;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted' using errcode = '42501';
  end if;

  select * into schedule_row
  from public.recurring_invoice_schedules
  where id = p_schedule_id and org_id = p_org_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Recurring schedule not found' using errcode = 'P0002';
  end if;
  if schedule_row.version is distinct from p_expected_version then
    raise exception 'Recurring schedule version conflict' using errcode = 'P0001';
  end if;
  if schedule_row.status <> 'active' then
    raise exception 'Only active recurring schedules can be paused'
      using errcode = '22023';
  end if;

  update public.recurring_invoice_schedules
  set
    status = 'paused',
    next_run_at = null,
    paused_at = now(),
    updated_by = actor_id
  where id = schedule_row.id;

  return private.recurring_schedule_document(schedule_row.id, p_org_id);
end;
$$;

revoke all on function public.pause_recurring_schedule(uuid, uuid, integer) from public, anon;
grant execute on function public.pause_recurring_schedule(uuid, uuid, integer) to authenticated;

create or replace function public.resume_recurring_schedule(
  p_schedule_id uuid,
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
  schedule_row public.recurring_invoice_schedules;
  next_at timestamptz;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted' using errcode = '42501';
  end if;

  select * into schedule_row
  from public.recurring_invoice_schedules
  where id = p_schedule_id and org_id = p_org_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Recurring schedule not found' using errcode = 'P0002';
  end if;
  if schedule_row.version is distinct from p_expected_version then
    raise exception 'Recurring schedule version conflict' using errcode = 'P0001';
  end if;
  if schedule_row.status <> 'paused' then
    raise exception 'Only paused recurring schedules can be resumed'
      using errcode = '22023';
  end if;

  -- Catch-up policy is recorded on the schedule; missed invoices are not
  -- auto-generated until the cron wave.
  next_at := private.compute_recurring_next_run_at(
    schedule_row.frequency,
    schedule_row.interval_count,
    schedule_row.anchor_on,
    schedule_row.start_on,
    schedule_row.end_on,
    schedule_row.timezone,
    schedule_row.local_run_time,
    schedule_row.day_of_month,
    schedule_row.weekdays,
    schedule_row.month_of_year,
    schedule_row.month_end_policy,
    now()
  );
  if next_at is null then
    raise exception 'Could not compute next_run_at for resume'
      using errcode = '22023';
  end if;

  update public.recurring_invoice_schedules
  set
    status = 'active',
    next_run_at = next_at,
    paused_at = null,
    updated_by = actor_id
  where id = schedule_row.id;

  return private.recurring_schedule_document(schedule_row.id, p_org_id);
end;
$$;

revoke all on function public.resume_recurring_schedule(uuid, uuid, integer) from public, anon;
grant execute on function public.resume_recurring_schedule(uuid, uuid, integer) to authenticated;

create or replace function public.cancel_recurring_schedule(
  p_schedule_id uuid,
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
  schedule_row public.recurring_invoice_schedules;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted' using errcode = '42501';
  end if;

  select * into schedule_row
  from public.recurring_invoice_schedules
  where id = p_schedule_id and org_id = p_org_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Recurring schedule not found' using errcode = 'P0002';
  end if;
  if schedule_row.version is distinct from p_expected_version then
    raise exception 'Recurring schedule version conflict' using errcode = 'P0001';
  end if;
  if schedule_row.status not in ('draft', 'active', 'paused') then
    raise exception 'Schedule cannot be cancelled from status %', schedule_row.status
      using errcode = '22023';
  end if;

  update public.recurring_invoice_schedules
  set
    status = 'cancelled',
    next_run_at = null,
    cancelled_at = now(),
    cancelled_by = actor_id,
    updated_by = actor_id
  where id = schedule_row.id;

  return private.recurring_schedule_document(schedule_row.id, p_org_id);
end;
$$;

revoke all on function public.cancel_recurring_schedule(uuid, uuid, integer) from public, anon;
grant execute on function public.cancel_recurring_schedule(uuid, uuid, integer) to authenticated;

create or replace function public.preview_recurring_schedule(
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
  org_currency char(3);
  org_tz text;
  v_frequency text;
  v_interval_count smallint;
  v_anchor_on date;
  v_weekdays smallint[];
  v_day_of_month smallint;
  v_month_of_year smallint;
  v_month_end_policy text;
  v_timezone text;
  v_local_run_time time;
  v_start_on date;
  v_end_on date;
  v_due_days smallint;
  v_currency char(3);
  wd jsonb;
  elem text;
  next_at timestamptz;
  next_issue date;
  next_due date;
  estimated bigint := 0;
  line_item jsonb;
  qty numeric(14, 4);
  unit_price bigint;
  discount numeric(7, 4);
  tax_rate numeric(7, 4);
  amounts record;
  product_row public.products;
  line_product_id uuid;
  product_tax numeric(7, 4);
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not private.has_org_role(
    p_org_id, array['owner', 'admin', 'member', 'billing', 'readonly']
  ) then
    raise exception 'This action is not permitted' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Schedule payload must be an object' using errcode = '22023';
  end if;

  select organisations.default_currency, organisations.timezone
  into org_currency, org_tz
  from public.organisations
  where organisations.id = p_org_id and organisations.deleted_at is null;
  if not found then
    raise exception 'Organisation not found' using errcode = 'P0002';
  end if;

  v_currency := upper(coalesce(nullif(trim(p_payload ->> 'currency'), ''), org_currency))::char(3);
  v_frequency := lower(nullif(trim(p_payload ->> 'frequency'), ''));
  if v_frequency is null or v_frequency not in ('daily', 'weekly', 'monthly', 'yearly') then
    raise exception 'Schedule frequency must be daily, weekly, monthly, or yearly' using errcode = '22023';
  end if;
  v_interval_count := coalesce((p_payload ->> 'interval_count')::smallint, 1);
  v_start_on := coalesce((p_payload ->> 'start_on')::date, (timezone('utc', now()))::date);
  v_anchor_on := coalesce((p_payload ->> 'anchor_on')::date, v_start_on);
  v_end_on := nullif(p_payload ->> 'end_on', '')::date;
  v_timezone := coalesce(nullif(trim(p_payload ->> 'timezone'), ''), org_tz, 'UTC');
  v_local_run_time := coalesce((p_payload ->> 'local_run_time')::time, time '09:00:00');
  v_due_days := coalesce((p_payload ->> 'due_days')::smallint, 14);
  v_month_end_policy := coalesce(nullif(trim(p_payload ->> 'month_end_policy'), ''), 'clamp');

  if v_frequency = 'weekly' then
    wd := p_payload -> 'weekdays';
    if wd is null or jsonb_typeof(wd) <> 'array' or jsonb_array_length(wd) < 1 then
      raise exception 'Weekly schedules require weekdays' using errcode = '22023';
    end if;
    v_weekdays := array[]::smallint[];
    for elem in select jsonb_array_elements_text(wd) loop
      v_weekdays := array_append(v_weekdays, elem::smallint);
    end loop;
  elsif v_frequency = 'monthly' then
    v_day_of_month := coalesce(
      (p_payload ->> 'day_of_month')::smallint,
      extract(day from v_anchor_on)::smallint
    );
  elsif v_frequency = 'yearly' then
    v_day_of_month := coalesce(
      (p_payload ->> 'day_of_month')::smallint,
      extract(day from v_anchor_on)::smallint
    );
    v_month_of_year := coalesce(
      (p_payload ->> 'month_of_year')::smallint,
      extract(month from v_anchor_on)::smallint
    );
  end if;

  next_at := private.compute_recurring_next_run_at(
    v_frequency, v_interval_count, v_anchor_on, v_start_on, v_end_on,
    v_timezone, v_local_run_time, v_day_of_month, v_weekdays, v_month_of_year,
    v_month_end_policy, now()
  );
  if next_at is not null then
    next_issue := (next_at at time zone v_timezone)::date;
    next_due := next_issue + v_due_days;
  end if;

  if p_lines is not null and jsonb_typeof(p_lines) = 'array' then
    for line_item in select value from jsonb_array_elements(p_lines) loop
      line_product_id := nullif(line_item ->> 'product_id', '')::uuid;
      qty := (line_item ->> 'quantity')::numeric;
      discount := coalesce((line_item ->> 'discount_percent')::numeric, 0);
      if line_product_id is not null then
        select * into product_row from public.products
        where id = line_product_id and org_id = p_org_id and deleted_at is null and status = 'active';
        if not found then
          raise exception 'Preview line product not found' using errcode = '22023';
        end if;
        unit_price := coalesce(nullif(line_item ->> 'unit_price_cents', '')::bigint, product_row.unit_price_cents);
        if line_item ? 'tax_rate_percent' and line_item ->> 'tax_rate_percent' is not null then
          tax_rate := (line_item ->> 'tax_rate_percent')::numeric;
        elsif product_row.tax_rate_id is not null then
          select rate_percent into product_tax from public.tax_rates
          where id = product_row.tax_rate_id and org_id = p_org_id and deleted_at is null and active;
          tax_rate := coalesce(product_tax, 0);
        else
          tax_rate := 0;
        end if;
      else
        unit_price := (line_item ->> 'unit_price_cents')::bigint;
        tax_rate := coalesce((line_item ->> 'tax_rate_percent')::numeric, 0);
      end if;
      if qty is null or qty <= 0 or unit_price is null then
        continue;
      end if;
      select * into amounts from private.calculate_quote_line_amounts(qty, unit_price, discount, tax_rate);
      estimated := estimated + amounts.total_cents;
    end loop;
  end if;

  return jsonb_build_object(
    'next_run_at', next_at,
    'next_issue_on', next_issue,
    'next_due_on', next_due,
    'estimated_total_cents', estimated,
    'currency', v_currency,
    'frequency', v_frequency,
    'interval_count', v_interval_count,
    'timezone', v_timezone,
    'local_run_time', v_local_run_time
  );
end;
$$;

revoke all on function public.preview_recurring_schedule(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.preview_recurring_schedule(uuid, jsonb, jsonb) to authenticated;



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
    'lines', lines_json
  );
end;
$$;

revoke all on function private.generate_invoice_from_recurring_run(
  uuid, public.recurring_invoice_schedules, public.recurring_invoice_runs, uuid
) from public, anon, authenticated;

create or replace function public.run_now_recurring_schedule(
  p_schedule_id uuid,
  p_org_id uuid,
  p_expected_version integer,
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
  schedule_row public.recurring_invoice_schedules;
  run_row public.recurring_invoice_runs;
  v_existing public.api_idempotency_keys;
  v_expires_at timestamptz := now() + make_interval(secs => greatest(coalesce(p_ttl_seconds, 86400), 60));
  occurrence_key text;
  local_date date;
  period_start date;
  period_end date;
  config_snapshot jsonb;
  invoice_doc jsonb;
  v_response_headers jsonb;
  v_response_body jsonb;
  lines_snapshot jsonb;
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

  select * into schedule_row
  from public.recurring_invoice_schedules
  where id = p_schedule_id and org_id = p_org_id and deleted_at is null
  for update;

  if not found then
    raise exception 'Recurring schedule not found' using errcode = 'P0002';
  end if;
  if schedule_row.version is distinct from p_expected_version then
    raise exception 'Recurring schedule version conflict' using errcode = 'P0001';
  end if;
  if schedule_row.status not in ('draft', 'active', 'paused') then
    raise exception 'run-now is not allowed for status %', schedule_row.status
      using errcode = '22023';
  end if;

  occurrence_key := 'manual:' || p_idempotency_key_hash;
  begin
    local_date := (now() at time zone schedule_row.timezone)::date;
  exception
    when others then
      local_date := (timezone('utc', now()))::date;
  end;

  -- Simple billing period: local day for daily; ISO week for weekly; calendar month; calendar year month
  if schedule_row.frequency = 'weekly' then
    period_start := local_date - ((extract(isodow from local_date)::integer) - 1);
    period_end := period_start + 6;
  elsif schedule_row.frequency = 'monthly' then
    period_start := date_trunc('month', local_date)::date;
    period_end := (date_trunc('month', local_date)::date + interval '1 month' - interval '1 day')::date;
  elsif schedule_row.frequency = 'yearly' then
    period_start := make_date(extract(year from local_date)::integer, 1, 1);
    period_end := make_date(extract(year from local_date)::integer, 12, 31);
  else
    period_start := local_date;
    period_end := local_date;
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(recurring_invoice_lines) order by position, id),
    '[]'::jsonb
  )
  into lines_snapshot
  from public.recurring_invoice_lines
  where schedule_id = schedule_row.id
    and org_id = p_org_id
    and deleted_at is null
    and active;

  if jsonb_array_length(lines_snapshot) < 1 then
    raise exception 'run-now requires at least one active line' using errcode = '22023';
  end if;

  config_snapshot := jsonb_build_object(
    'schedule', to_jsonb(schedule_row),
    'lines', lines_snapshot
  );

  insert into public.recurring_invoice_runs (
    org_id, schedule_id, occurrence_sequence, occurrence_key,
    scheduled_for, occurrence_local_date, occurrence_timezone,
    schedule_version, configuration_snapshot, period_start, period_end,
    trigger, status, attempt_count, available_at, claimed_at, claimed_by,
    generated_at, request_id
  ) values (
    p_org_id, schedule_row.id, null, occurrence_key,
    now(), local_date, schedule_row.timezone,
    schedule_row.rule_version, config_snapshot, period_start, period_end,
    'manual', 'processing', 1, now(), now(), 'run-now:' || v_actor_id::text,
    null, null
  )
  returning * into run_row;

  invoice_doc := private.generate_invoice_from_recurring_run(
    p_org_id, schedule_row, run_row, v_actor_id
  );

  update public.recurring_invoice_runs
  set
    status = 'generated',
    generated_at = now(),
    updated_at = now()
  where id = run_row.id
  returning * into run_row;

  -- Do not advance next_run_at or scheduled_occurrence_count for manual runs.
  update public.recurring_invoice_schedules
  set last_run_at = now(), updated_by = v_actor_id
  where id = schedule_row.id;

  v_response_headers := jsonb_build_object(
    'etag', '"' || (private.recurring_schedule_document(schedule_row.id, p_org_id) -> 'schedule' ->> 'version') || '"'
  );
  v_response_body := jsonb_build_object(
    'status', 200,
    'body', jsonb_build_object(
      'data', jsonb_build_object(
        'run', to_jsonb(run_row),
        'invoice', invoice_doc -> 'invoice',
        'lines', invoice_doc -> 'lines',
        'schedule', private.recurring_schedule_document(schedule_row.id, p_org_id) -> 'schedule'
      )
    ),
    'headers', v_response_headers
  );

  update public.api_idempotency_keys
  set
    response_status = 200,
    response_body = v_response_body,
    resource_type = 'recurring_invoice_run',
    resource_id = run_row.id
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

revoke all on function public.run_now_recurring_schedule(
  uuid, uuid, integer, text, text, text, integer
) from public, anon;
grant execute on function public.run_now_recurring_schedule(
  uuid, uuid, integer, text, text, text, integer
) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------------

alter table public.recurring_invoice_schedules enable row level security;
alter table public.recurring_invoice_lines enable row level security;
alter table public.recurring_invoice_runs enable row level security;

create policy recurring_invoice_schedules_select_member
on public.recurring_invoice_schedules
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'billing', 'readonly']
  )
);

create policy recurring_invoice_lines_select_member
on public.recurring_invoice_lines
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'billing', 'readonly']
  )
  and exists (
    select 1 from public.recurring_invoice_schedules s
    where s.id = recurring_invoice_lines.schedule_id
      and s.org_id = recurring_invoice_lines.org_id
      and s.deleted_at is null
  )
);

create policy recurring_invoice_runs_select_member
on public.recurring_invoice_runs
for select
to authenticated
using (
  private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'billing', 'readonly']
  )
);

revoke all on table public.recurring_invoice_schedules from public, anon, authenticated;
revoke all on table public.recurring_invoice_lines from public, anon, authenticated;
revoke all on table public.recurring_invoice_runs from public, anon, authenticated;

grant select on table public.recurring_invoice_schedules to authenticated;
grant select on table public.recurring_invoice_lines to authenticated;
grant select on table public.recurring_invoice_runs to authenticated;

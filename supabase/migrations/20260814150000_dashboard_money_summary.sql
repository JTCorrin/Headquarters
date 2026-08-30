-- Org dashboard money summary: KPIs, AR aging, monthly cash/booked, quote
-- pipeline, and chase lists. Money sums use the organisation default currency.

create index if not exists invoices_org_open_due_on_idx
  on public.invoices (org_id, due_on)
  where deleted_at is null
    and status in ('sent', 'partial')
    and balance_due_cents > 0;

create or replace function public.dashboard_money_summary(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  org_currency char(3);
  as_of date := (timezone('utc', now()))::date;
  can_read_quotes boolean;
  other_currency_count integer := 0;
  outstanding_cents bigint := 0;
  overdue_cents bigint := 0;
  open_invoice_count integer := 0;
  overdue_invoice_count integer := 0;
  cash_30d bigint := 0;
  cash_prior_30d bigint := 0;
  booked_30d bigint := 0;
  booked_prior_30d bigint := 0;
  aging_json jsonb;
  monthly_json jsonb;
  quote_pipeline_json jsonb := '[]'::jsonb;
  overdue_invoices_json jsonb := '[]'::jsonb;
  due_soon_invoices_json jsonb := '[]'::jsonb;
  awaiting_quotes_json jsonb := '[]'::jsonb;
  expiring_quotes_json jsonb := '[]'::jsonb;
  month_start date;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  -- Same audience as invoice/payment GET (includes billing + readonly).
  if not private.has_org_role(
    p_org_id,
    array['owner', 'admin', 'member', 'readonly', 'billing']
  ) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  select organisations.default_currency
    into org_currency
  from public.organisations
  where organisations.id = p_org_id
    and organisations.deleted_at is null;

  if not found then
    raise exception 'Organisation not found'
      using errcode = 'P0002';
  end if;

  can_read_quotes := private.has_org_role(
    p_org_id,
    array['owner', 'admin', 'member', 'readonly']
  );

  select count(*)::integer
    into other_currency_count
  from (
    select 1
    from public.invoices
    where invoices.org_id = p_org_id
      and invoices.deleted_at is null
      and invoices.currency is distinct from org_currency
    union all
    select 1
    from public.payments
    where payments.org_id = p_org_id
      and payments.currency is distinct from org_currency
    union all
    select 1
    from public.quotes
    where quotes.org_id = p_org_id
      and quotes.deleted_at is null
      and quotes.currency is distinct from org_currency
  ) other_docs;

  select
    coalesce(sum(invoices.balance_due_cents), 0),
    coalesce(
      sum(invoices.balance_due_cents)
        filter (where invoices.due_on < as_of),
      0
    ),
    count(*)::integer,
    count(*) filter (where invoices.due_on < as_of)::integer
  into
    outstanding_cents,
    overdue_cents,
    open_invoice_count,
    overdue_invoice_count
  from public.invoices
  where invoices.org_id = p_org_id
    and invoices.deleted_at is null
    and invoices.currency = org_currency
    and invoices.status in ('sent', 'partial')
    and invoices.balance_due_cents > 0;

  select coalesce(sum(payments.amount_cents), 0)
    into cash_30d
  from public.payments
  where payments.org_id = p_org_id
    and payments.currency = org_currency
    and payments.direction = 'inbound'
    and payments.reverses_payment_id is null
    and payments.status in ('completed', 'allocated', 'part_allocated', 'unallocated')
    and payments.occurred_on >= (as_of - 29)
    and payments.occurred_on <= as_of;

  select coalesce(sum(payments.amount_cents), 0)
    into cash_prior_30d
  from public.payments
  where payments.org_id = p_org_id
    and payments.currency = org_currency
    and payments.direction = 'inbound'
    and payments.reverses_payment_id is null
    and payments.status in ('completed', 'allocated', 'part_allocated', 'unallocated')
    and payments.occurred_on >= (as_of - 59)
    and payments.occurred_on <= (as_of - 30);

  select coalesce(sum(invoices.total_cents), 0)
    into booked_30d
  from public.invoices
  where invoices.org_id = p_org_id
    and invoices.deleted_at is null
    and invoices.currency = org_currency
    and invoices.status in ('sent', 'partial', 'paid')
    and invoices.issue_on >= (as_of - 29)
    and invoices.issue_on <= as_of;

  select coalesce(sum(invoices.total_cents), 0)
    into booked_prior_30d
  from public.invoices
  where invoices.org_id = p_org_id
    and invoices.deleted_at is null
    and invoices.currency = org_currency
    and invoices.status in ('sent', 'partial', 'paid')
    and invoices.issue_on >= (as_of - 59)
    and invoices.issue_on <= (as_of - 30);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'bucket', bucket,
        'cents', cents,
        'count', cnt
      )
      order by sort_order
    ),
    '[]'::jsonb
  )
  into aging_json
  from (
    select
      buckets.bucket,
      buckets.sort_order,
      coalesce(sum(open_inv.balance_due_cents), 0)::bigint as cents,
      count(open_inv.id)::integer as cnt
    from (
      values
        ('current', 0),
        ('1_30', 1),
        ('31_60', 2),
        ('61_90', 3),
        ('90_plus', 4)
    ) as buckets(bucket, sort_order)
    left join lateral (
      select invoices.id, invoices.balance_due_cents, invoices.due_on
      from public.invoices
      where invoices.org_id = p_org_id
        and invoices.deleted_at is null
        and invoices.currency = org_currency
        and invoices.status in ('sent', 'partial')
        and invoices.balance_due_cents > 0
        and (
          (buckets.bucket = 'current' and invoices.due_on >= as_of)
          or (
            buckets.bucket = '1_30'
            and invoices.due_on < as_of
            and invoices.due_on >= (as_of - 30)
          )
          or (
            buckets.bucket = '31_60'
            and invoices.due_on < (as_of - 30)
            and invoices.due_on >= (as_of - 60)
          )
          or (
            buckets.bucket = '61_90'
            and invoices.due_on < (as_of - 60)
            and invoices.due_on >= (as_of - 90)
          )
          or (
            buckets.bucket = '90_plus'
            and invoices.due_on < (as_of - 90)
          )
        )
    ) open_inv on true
    group by buckets.bucket, buckets.sort_order
  ) aging_rows;

  month_start := (date_trunc('month', as_of::timestamp) - interval '5 months')::date;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'month', to_char(month_series.month_start, 'YYYY-MM'),
        'cash_cents', coalesce(cash_m.cents, 0),
        'booked_cents', coalesce(booked_m.cents, 0)
      )
      order by month_series.month_start
    ),
    '[]'::jsonb
  )
  into monthly_json
  from generate_series(
    month_start,
    date_trunc('month', as_of::timestamp)::date,
    interval '1 month'
  ) as month_series(month_start)
  left join lateral (
    select coalesce(sum(payments.amount_cents), 0)::bigint as cents
    from public.payments
    where payments.org_id = p_org_id
      and payments.currency = org_currency
      and payments.direction = 'inbound'
      and payments.reverses_payment_id is null
      and payments.status in ('completed', 'allocated', 'part_allocated', 'unallocated')
      and payments.occurred_on >= month_series.month_start::date
      and payments.occurred_on < (month_series.month_start + interval '1 month')::date
  ) cash_m on true
  left join lateral (
    select coalesce(sum(invoices.total_cents), 0)::bigint as cents
    from public.invoices
    where invoices.org_id = p_org_id
      and invoices.deleted_at is null
      and invoices.currency = org_currency
      and invoices.status in ('sent', 'partial', 'paid')
      and invoices.issue_on >= month_series.month_start::date
      and invoices.issue_on < (month_series.month_start + interval '1 month')::date
  ) booked_m on true;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', invoices.id,
        'number', invoices.number,
        'client_name', coalesce(
          nullif(trim(invoices.party_snapshot -> 'client' ->> 'name'), ''),
          'Client'
        ),
        'amount_cents', invoices.balance_due_cents,
        'days', (as_of - invoices.due_on)
      )
      order by invoices.due_on asc, invoices.balance_due_cents desc
    ),
    '[]'::jsonb
  )
  into overdue_invoices_json
  from (
    select *
    from public.invoices
    where invoices.org_id = p_org_id
      and invoices.deleted_at is null
      and invoices.currency = org_currency
      and invoices.status in ('sent', 'partial')
      and invoices.balance_due_cents > 0
      and invoices.due_on < as_of
    order by invoices.due_on asc, invoices.balance_due_cents desc
    limit 8
  ) invoices;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', invoices.id,
        'number', invoices.number,
        'client_name', coalesce(
          nullif(trim(invoices.party_snapshot -> 'client' ->> 'name'), ''),
          'Client'
        ),
        'amount_cents', invoices.balance_due_cents,
        'days', (invoices.due_on - as_of)
      )
      order by invoices.due_on asc, invoices.balance_due_cents desc
    ),
    '[]'::jsonb
  )
  into due_soon_invoices_json
  from (
    select *
    from public.invoices
    where invoices.org_id = p_org_id
      and invoices.deleted_at is null
      and invoices.currency = org_currency
      and invoices.status in ('sent', 'partial')
      and invoices.balance_due_cents > 0
      and invoices.due_on >= as_of
      and invoices.due_on <= (as_of + 7)
    order by invoices.due_on asc, invoices.balance_due_cents desc
    limit 5
  ) invoices;

  if can_read_quotes then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'status', statuses.status,
          'count', coalesce(agg.cnt, 0),
          'total_cents', coalesce(agg.total_cents, 0)
        )
        order by statuses.sort_order
      ),
      '[]'::jsonb
    )
    into quote_pipeline_json
    from (
      values
        ('draft', 0),
        ('sent', 1),
        ('accepted', 2),
        ('rejected', 3)
    ) as statuses(status, sort_order)
    left join lateral (
      select
        count(*)::integer as cnt,
        coalesce(sum(quotes.total_cents), 0)::bigint as total_cents
      from public.quotes
      where quotes.org_id = p_org_id
        and quotes.deleted_at is null
        and quotes.currency = org_currency
        and quotes.status = statuses.status
    ) agg on true;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', quotes.id,
          'number', quotes.number,
          'client_name', coalesce(
            nullif(trim(quotes.party_snapshot -> 'client' ->> 'name'), ''),
            nullif(trim(quotes.title), ''),
            'Quote'
          ),
          'amount_cents', quotes.total_cents,
          'days', greatest(
            0,
            (as_of - coalesce(quotes.sent_at::date, quotes.issue_on))
          )
        )
        order by coalesce(quotes.sent_at, quotes.issue_on::timestamptz) asc
      ),
      '[]'::jsonb
    )
    into awaiting_quotes_json
    from (
      select *
      from public.quotes
      where quotes.org_id = p_org_id
        and quotes.deleted_at is null
        and quotes.currency = org_currency
        and quotes.status = 'sent'
      order by coalesce(quotes.sent_at, quotes.issue_on::timestamptz) asc
      limit 5
    ) quotes;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', quotes.id,
          'number', quotes.number,
          'client_name', coalesce(
            nullif(trim(quotes.party_snapshot -> 'client' ->> 'name'), ''),
            nullif(trim(quotes.title), ''),
            'Quote'
          ),
          'amount_cents', quotes.total_cents,
          'days', (quotes.valid_until - as_of)
        )
        order by quotes.valid_until asc
      ),
      '[]'::jsonb
    )
    into expiring_quotes_json
    from (
      select *
      from public.quotes
      where quotes.org_id = p_org_id
        and quotes.deleted_at is null
        and quotes.currency = org_currency
        and quotes.status in ('draft', 'sent')
        and quotes.valid_until is not null
        and quotes.valid_until >= as_of
        and quotes.valid_until <= (as_of + 7)
      order by quotes.valid_until asc
      limit 5
    ) quotes;
  end if;

  return jsonb_build_object(
    'currency', org_currency,
    'as_of', as_of,
    'kpis', jsonb_build_object(
      'outstanding_cents', outstanding_cents,
      'overdue_cents', overdue_cents,
      'open_invoice_count', open_invoice_count,
      'overdue_invoice_count', overdue_invoice_count,
      'cash_collected_30d_cents', cash_30d,
      'cash_collected_prior_30d_cents', cash_prior_30d,
      'booked_30d_cents', booked_30d,
      'booked_prior_30d_cents', booked_prior_30d
    ),
    'aging', aging_json,
    'monthly', monthly_json,
    'quote_pipeline', quote_pipeline_json,
    'chase', jsonb_build_object(
      'overdue_invoices', overdue_invoices_json,
      'due_soon_invoices', due_soon_invoices_json,
      'awaiting_quotes', awaiting_quotes_json,
      'expiring_quotes', expiring_quotes_json
    ),
    'other_currency_doc_count', other_currency_count
  );
end;
$$;

revoke all on function public.dashboard_money_summary(uuid)
  from public, anon;
grant execute on function public.dashboard_money_summary(uuid) to authenticated;

comment on function public.dashboard_money_summary(uuid) is
  'Org money dashboard: AR KPIs, aging, monthly cash/booked, quote pipeline, chase lists.';

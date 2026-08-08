-- Org-scoped payments list with optional invoice/bill allocation join.
-- Avoids the Data API max_rows=1000 truncation when materializing payment_ids.

create or replace function public.list_payments(
  p_org_id uuid,
  p_limit integer default 50,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_direction text default null,
  p_status text default null,
  p_client_id uuid default null,
  p_vendor_id uuid default null,
  p_invoice_id uuid default null,
  p_bill_id uuid default null
)
returns setof public.payments
language sql
stable
security invoker
set search_path = ''
as $$
  select p.*
  from public.payments as p
  where p.org_id = p_org_id
    and (p_direction is null or p.direction = p_direction)
    and (p_status is null or p.status = p_status)
    and (p_client_id is null or p.client_id = p_client_id)
    and (p_vendor_id is null or p.vendor_id = p_vendor_id)
    and (
      p_invoice_id is null
      or exists (
        select 1
        from public.payment_allocations as a
        where a.org_id = p.org_id
          and a.payment_id = p.id
          and a.invoice_id = p_invoice_id
      )
    )
    and (
      p_bill_id is null
      or exists (
        select 1
        from public.payment_allocations as a
        where a.org_id = p.org_id
          and a.payment_id = p.id
          and a.bill_id = p_bill_id
      )
    )
    and (
      p_cursor_created_at is null
      or p_cursor_id is null
      or p.created_at < p_cursor_created_at
      or (
        p.created_at = p_cursor_created_at
        and p.id < p_cursor_id
      )
    )
  order by p.created_at desc, p.id desc
  -- Edge may request limit+1 (max 201) for next_cursor detection.
  limit greatest(least(coalesce(p_limit, 50), 201), 1);
$$;

revoke all on function public.list_payments(
  uuid, integer, timestamptz, uuid, text, text, uuid, uuid, uuid, uuid
) from public, anon;

grant execute on function public.list_payments(
  uuid, integer, timestamptz, uuid, text, text, uuid, uuid, uuid, uuid
) to authenticated;

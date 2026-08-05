-- Org-wide Home activity feed: org-time index + primary-rail list RPC.
-- Plan: PLANS/ORG_ACTIVITY_FEED_V1.md (dedupe B).

create index timeline_events_org_occurred_idx
  on public.timeline_events (org_id, occurred_at desc, id desc);

-- SECURITY INVOKER so timeline_events_select_member RLS applies
-- (billing omits lead / conversion / source_type=lead).
create or replace function public.list_org_timeline_events(
  p_org_id uuid,
  p_limit integer default 50,
  p_cursor_occurred_at timestamptz default null,
  p_cursor_id uuid default null
)
returns setof public.timeline_events
language sql
stable
security invoker
set search_path = ''
as $$
  select te.*
  from public.timeline_events as te
  where te.org_id = p_org_id
    -- Dedupe B: composer notes (null source) + primary lifecycle cards
    and (te.source_type is null or te.entity_type = te.source_type)
    and (
      p_cursor_occurred_at is null
      or p_cursor_id is null
      or te.occurred_at < p_cursor_occurred_at
      or (
        te.occurred_at = p_cursor_occurred_at
        and te.id < p_cursor_id
      )
    )
  order by te.occurred_at desc, te.id desc
  -- Edge may request limit+1 (max 201) for next_cursor detection.
  limit greatest(least(coalesce(p_limit, 50), 201), 1);
$$;

revoke all on function public.list_org_timeline_events(
  uuid, integer, timestamptz, uuid
) from public, anon;

grant execute on function public.list_org_timeline_events(
  uuid, integer, timestamptz, uuid
) to authenticated;

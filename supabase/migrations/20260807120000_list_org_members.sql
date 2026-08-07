-- Org directory: list active mentionable/assignable memberships for the
-- selected org (display names from profiles). Used by timeline @mentions and
-- task assignee pickers.

create or replace function public.list_org_members(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  rows jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  -- Same audience as personal notifications: not billing.
  if not private.has_org_role(
    p_org_id,
    array['owner', 'admin', 'member', 'readonly']
  ) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'membership_id', m.id,
        'user_id', m.user_id,
        'display_name', p.display_name,
        'role', m.role,
        'job_title', m.job_title
      )
      order by lower(p.display_name), m.id
    ),
    '[]'::jsonb
  )
  into rows
  from public.memberships m
  join public.profiles p on p.id = m.user_id
  where m.org_id = p_org_id
    and m.status = 'active'
    and m.role in ('owner', 'admin', 'member', 'readonly');

  return rows;
end;
$$;

revoke all on function public.list_org_members(uuid) from public, anon;
grant execute on function public.list_org_members(uuid) to authenticated;

comment on function public.list_org_members(uuid) is
  'Active org memberships with profile display_name for @mentions and assignees.';

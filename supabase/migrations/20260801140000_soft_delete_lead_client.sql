-- Lead/client soft-delete via security-definer RPCs.
-- Staging curl proof showed authenticated UPDATE ... SET deleted_at = now()
-- fails with 42501 ("This action is not permitted") — same gap contacts hit.
-- Mirror soft_delete_contact / soft_delete_quote_draft.

create or replace function public.soft_delete_lead(
  p_lead_id uuid,
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
  lead_row public.leads;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into lead_row
  from public.leads
  where leads.id = p_lead_id
    and leads.org_id = p_org_id
    and leads.deleted_at is null
  for update;

  if not found then
    raise exception 'Lead not found'
      using errcode = 'P0002';
  end if;

  if lead_row.version is distinct from p_expected_version then
    raise exception 'Lead version conflict'
      using errcode = 'P0001';
  end if;

  update public.leads
  set
    deleted_at = now(),
    updated_by = actor_id
  where leads.id = lead_row.id;
end;
$$;

create or replace function public.soft_delete_client(
  p_client_id uuid,
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
  client_row public.clients;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into client_row
  from public.clients
  where clients.id = p_client_id
    and clients.org_id = p_org_id
    and clients.deleted_at is null
  for update;

  if not found then
    raise exception 'Client not found'
      using errcode = 'P0002';
  end if;

  if client_row.version is distinct from p_expected_version then
    raise exception 'Client version conflict'
      using errcode = 'P0001';
  end if;

  update public.clients
  set
    deleted_at = now(),
    updated_by = actor_id
  where clients.id = client_row.id;
end;
$$;

revoke all on function public.soft_delete_lead(uuid, uuid, integer)
  from public, anon;
grant execute on function public.soft_delete_lead(uuid, uuid, integer)
  to authenticated;

revoke all on function public.soft_delete_client(uuid, uuid, integer)
  from public, anon;
grant execute on function public.soft_delete_client(uuid, uuid, integer)
  to authenticated;

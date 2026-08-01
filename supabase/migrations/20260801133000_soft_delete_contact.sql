-- Contact soft-delete via security-definer RPC.
-- Staging curl proof showed authenticated UPDATE ... SET deleted_at = now()
-- fails with 42501 ("new row violates row-level security policy") even though
-- contacts_update_member WITH CHECK does not require deleted_at IS NULL.
-- Quotes already mutate through SECURITY DEFINER RPCs; mirror that for contacts.

create or replace function public.soft_delete_contact(
  p_contact_id uuid,
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
  contact_row public.contacts;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into contact_row
  from public.contacts
  where contacts.id = p_contact_id
    and contacts.org_id = p_org_id
    and contacts.deleted_at is null
  for update;

  if not found then
    raise exception 'Contact not found'
      using errcode = 'P0002';
  end if;

  if contact_row.version is distinct from p_expected_version then
    raise exception 'Contact version conflict'
      using errcode = 'P0001';
  end if;

  update public.contacts
  set
    deleted_at = now(),
    updated_by = actor_id
  where contacts.id = contact_row.id;
end;
$$;

revoke all on function public.soft_delete_contact(uuid, uuid, integer)
  from public, anon;
grant execute on function public.soft_delete_contact(uuid, uuid, integer)
  to authenticated;

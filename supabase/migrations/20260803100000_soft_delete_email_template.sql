-- Email template soft-delete via security-definer RPC.
-- Staging curl proof showed authenticated UPDATE ... SET deleted_at
-- fails (500 on Edge DELETE) — same class as products/contacts.

create or replace function public.soft_delete_email_template(
  p_template_id uuid,
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
  template_row public.email_templates;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into template_row
  from public.email_templates
  where email_templates.id = p_template_id
    and email_templates.org_id = p_org_id
    and email_templates.deleted_at is null
  for update;

  if not found then
    raise exception 'Email template not found'
      using errcode = 'P0002';
  end if;

  if template_row.version is distinct from p_expected_version then
    raise exception 'Email template version conflict'
      using errcode = 'P0001';
  end if;

  update public.email_templates
  set
    deleted_at = now(),
    status = 'archived',
    updated_by = actor_id
  where email_templates.id = template_row.id;
end;
$$;

revoke all on function public.soft_delete_email_template(uuid, uuid, integer)
  from public, anon;
grant execute on function public.soft_delete_email_template(uuid, uuid, integer)
  to authenticated;

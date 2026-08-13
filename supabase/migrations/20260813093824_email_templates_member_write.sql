-- Members may create, update, and soft-delete email templates.
-- Org config (defaults, tax, integrations) stays owner-only.

drop policy if exists email_templates_insert_admin on public.email_templates;
drop policy if exists email_templates_update_admin on public.email_templates;

create policy email_templates_insert_member
on public.email_templates
for insert
to authenticated
with check (
  private.has_org_role(org_id, array['owner', 'admin', 'member'])
  and created_by = auth.uid()
  and updated_by = auth.uid()
);

create policy email_templates_update_member
on public.email_templates
for update
to authenticated
using (
  deleted_at is null
  and private.has_org_role(org_id, array['owner', 'admin', 'member'])
)
with check (
  private.has_org_role(org_id, array['owner', 'admin', 'member'])
  and updated_by = auth.uid()
);

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

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
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

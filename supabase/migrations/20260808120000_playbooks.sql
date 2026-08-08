-- Playbooks (Comms automations) — Phase A: catalog + graph CRUD.
-- See PLANS/CRM_PLAYBOOKS_IMPLEMENTATION.md in Buzz nest.

set search_path = public, extensions, pg_catalog;

create table public.playbooks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  name text not null check (char_length(name) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),
  graph_json jsonb not null,
  is_active boolean not null default false,
  constraint playbooks_org_id_id_key unique (org_id, id),
  constraint playbooks_graph_json_object_check
    check (jsonb_typeof(graph_json) = 'object')
);

create unique index playbooks_org_name_uidx
  on public.playbooks (org_id, lower(name))
  where deleted_at is null;

create index playbooks_org_created_idx
  on public.playbooks (org_id, created_at desc, id desc)
  where deleted_at is null;

create index playbooks_org_active_idx
  on public.playbooks (org_id, is_active)
  where deleted_at is null;

create trigger playbooks_stamp_business_row
before insert or update on public.playbooks
for each row execute function private.stamp_business_row();

alter table public.playbooks enable row level security;

create policy playbooks_select_member
on public.playbooks
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
);

create policy playbooks_insert_member
on public.playbooks
for insert
to authenticated
with check (
  private.has_org_role(org_id, array['owner', 'admin', 'member'])
  and created_by = auth.uid()
  and updated_by = auth.uid()
);

create policy playbooks_update_member
on public.playbooks
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

revoke all on table public.playbooks from public, anon, authenticated;

grant select on table public.playbooks to authenticated;
grant insert (
  org_id,
  name,
  description,
  graph_json,
  is_active
) on table public.playbooks to authenticated;
grant update (
  name,
  description,
  graph_json,
  is_active,
  deleted_at
) on table public.playbooks to authenticated;

create or replace function public.soft_delete_playbook(
  p_playbook_id uuid,
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
  playbook_row public.playbooks;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into playbook_row
  from public.playbooks
  where playbooks.id = p_playbook_id
    and playbooks.org_id = p_org_id
    and playbooks.deleted_at is null
  for update;

  if not found then
    raise exception 'Playbook not found'
      using errcode = 'P0002';
  end if;

  if playbook_row.version is distinct from p_expected_version then
    raise exception 'Playbook version conflict'
      using errcode = 'P0001';
  end if;

  update public.playbooks
  set
    deleted_at = now(),
    is_active = false,
    updated_by = actor_id
  where playbooks.id = playbook_row.id;
end;
$$;

revoke all on function public.soft_delete_playbook(uuid, uuid, integer)
  from public, anon;
grant execute on function public.soft_delete_playbook(uuid, uuid, integer)
  to authenticated;

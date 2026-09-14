-- Notes foundation: private, per-membership free-form notes.
-- A note belongs to exactly one membership (user within an org); nobody else in
-- the org can read or write it. Body is stored as Tiptap JSON plus a plain-text
-- projection used for search and list excerpts.

set search_path = public, extensions, pg_catalog;

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  owner_membership_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  title text not null default '' check (char_length(title) <= 200),
  body jsonb not null default '{"type":"doc","content":[]}'::jsonb,
  body_text text not null default '' check (char_length(body_text) <= 100000),
  color text not null default 'yellow',
  pinned boolean not null default false,
  search tsvector generated always as (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body_text, ''))
  ) stored,
  constraint notes_org_id_id_key unique (org_id, id),
  constraint notes_owner_membership_fk
    foreign key (org_id, owner_membership_id)
    references public.memberships (org_id, id)
    on delete cascade,
  constraint notes_body_object_check
    check (jsonb_typeof(body) = 'object'),
  constraint notes_color_check
    check (color in ('yellow', 'green', 'blue', 'pink', 'purple', 'gray'))
);

comment on table public.notes is
  'Private per-membership notes. Only the owning membership can read or write a note.';

create index notes_owner_list_idx
  on public.notes (
    org_id, owner_membership_id, pinned desc, updated_at desc, id desc
  )
  where deleted_at is null;

create index notes_search_idx
  on public.notes using gin (search);

create trigger notes_stamp_business_row
before insert or update on public.notes
for each row execute function private.stamp_business_row();

-- Owner membership is immutable once set; it always belongs to the caller.
create or replace function private.validate_note_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.owner_membership_id is distinct from old.owner_membership_id then
      raise exception 'Note owner cannot be changed'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if not exists (
    select 1
    from public.memberships
    where memberships.id = new.owner_membership_id
      and memberships.org_id = new.org_id
      and memberships.status = 'active'
  ) then
    raise exception 'Note owner must be an active membership in the same organisation'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_note_owner()
  from public, anon, authenticated;

create trigger notes_validate_owner
before insert or update of owner_membership_id on public.notes
for each row execute function private.validate_note_owner();

create or replace function public.soft_delete_note(
  p_note_id uuid,
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
  actor_membership public.memberships;
  note_row public.notes;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  select memberships.* into actor_membership
  from public.memberships
  join public.organisations
    on organisations.id = memberships.org_id
  where memberships.org_id = p_org_id
    and memberships.user_id = actor_id
    and memberships.status = 'active'
    and organisations.deleted_at is null;

  if actor_membership.id is null
    or actor_membership.role not in ('owner', 'admin', 'member')
  then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into note_row
  from public.notes
  where notes.id = p_note_id
    and notes.org_id = p_org_id
    and notes.deleted_at is null
  for update;

  -- Not found and not-yours are indistinguishable on purpose.
  if not found or note_row.owner_membership_id is distinct from actor_membership.id then
    raise exception 'Note not found'
      using errcode = 'P0002';
  end if;

  if note_row.version is distinct from p_expected_version then
    raise exception 'Note version conflict'
      using errcode = 'P0001';
  end if;

  update public.notes
  set
    deleted_at = now(),
    updated_by = actor_id
  where notes.id = note_row.id;
end;
$$;

revoke all on function public.soft_delete_note(uuid, uuid, integer)
  from public, anon;
grant execute on function public.soft_delete_note(uuid, uuid, integer)
  to authenticated;

alter table public.notes enable row level security;

create policy notes_select_owner
on public.notes
for select
to authenticated
using (
  deleted_at is null
  and owner_membership_id = private.current_membership_id(org_id)
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
);

create policy notes_insert_owner
on public.notes
for insert
to authenticated
with check (
  owner_membership_id = private.current_membership_id(org_id)
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member']
  )
  and created_by = auth.uid()
  and updated_by = auth.uid()
);

create policy notes_update_owner
on public.notes
for update
to authenticated
using (
  deleted_at is null
  and owner_membership_id = private.current_membership_id(org_id)
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member']
  )
)
with check (
  owner_membership_id = private.current_membership_id(org_id)
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member']
  )
  and updated_by = auth.uid()
);

-- Hosted-billing guard, matching the restrictive policy/trigger applied to all
-- org-scoped tables in 20260907140000_hosted_billing_enforcement.sql.
create policy hosted_subscription_required
on public.notes
as restrictive
for all
to authenticated
using (private.hosted_org_access(org_id))
with check (private.hosted_org_access(org_id));

create trigger hosted_subscription_required
before insert or update or delete on public.notes
for each row execute function private.guard_hosted_tenant_write();

grant select, insert, update on table public.notes to authenticated;

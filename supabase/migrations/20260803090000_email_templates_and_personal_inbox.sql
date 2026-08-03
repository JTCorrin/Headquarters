-- Email templates catalog (§8.1) + personal working inbox list RPC.
-- See PLANS/EMAIL_INBOX_AND_TEMPLATES_SLICE.md.

set search_path = public, extensions, pg_catalog;

-- ---------------------------------------------------------------------------
-- email_templates
-- ---------------------------------------------------------------------------

create table public.email_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  name text not null check (char_length(name) between 1 and 200),
  subject text not null check (char_length(subject) between 1 and 200),
  body_text text,
  body_html text,
  category text not null,
  status text not null,
  merge_schema jsonb not null default '[]'::jsonb,
  constraint email_templates_org_id_id_key unique (org_id, id),
  constraint email_templates_category_check
    check (category in ('transactional', 'campaign', 'chase', 'onboarding', 'other')),
  constraint email_templates_status_check
    check (status in ('draft', 'active', 'archived')),
  constraint email_templates_merge_schema_array_check
    check (jsonb_typeof(merge_schema) = 'array')
);

create unique index email_templates_org_name_uidx
  on public.email_templates (org_id, lower(name))
  where deleted_at is null;

create index email_templates_org_created_idx
  on public.email_templates (org_id, created_at desc, id desc)
  where deleted_at is null;

create index email_templates_org_status_idx
  on public.email_templates (org_id, status)
  where deleted_at is null;

create trigger email_templates_stamp_business_row
before insert or update on public.email_templates
for each row execute function private.stamp_business_row();

-- Link existing nullable email_messages.template_id now that the catalog exists.
alter table public.email_messages
  add constraint email_messages_template_fk
    foreign key (org_id, template_id)
    references public.email_templates (org_id, id)
    on delete set null (template_id);

alter table public.email_templates enable row level security;

create policy email_templates_select_member
on public.email_templates
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
);

create policy email_templates_insert_admin
on public.email_templates
for insert
to authenticated
with check (
  private.has_org_role(org_id, array['owner', 'admin'])
  and created_by = auth.uid()
  and updated_by = auth.uid()
);

create policy email_templates_update_admin
on public.email_templates
for update
to authenticated
using (
  deleted_at is null
  and private.has_org_role(org_id, array['owner', 'admin'])
)
with check (
  private.has_org_role(org_id, array['owner', 'admin'])
  and updated_by = auth.uid()
);

revoke all on table public.email_templates from public, anon, authenticated;

grant select on table public.email_templates to authenticated;
grant insert (
  org_id,
  name,
  subject,
  body_text,
  body_html,
  category,
  status,
  merge_schema
) on table public.email_templates to authenticated;
grant update (
  name,
  subject,
  body_text,
  body_html,
  category,
  status,
  merge_schema,
  deleted_at
) on table public.email_templates to authenticated;

-- ---------------------------------------------------------------------------
-- Personal working inbox (caller mailbox only — no timeline_share bleed)
-- ---------------------------------------------------------------------------

create or replace function public.list_my_email_messages(
  p_org_id uuid,
  p_limit integer default 50,
  p_cursor_received_at timestamptz default null,
  p_cursor_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  membership_row public.memberships;
  lim integer := greatest(least(coalesce(p_limit, 50), 200), 1);
  rows jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  if not private.has_org_role(
    p_org_id,
    array['owner', 'admin', 'member', 'readonly']
  ) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select * into membership_row
  from public.memberships
  where memberships.org_id = p_org_id
    and memberships.user_id = actor_id
    and memberships.status = 'active';

  if not found then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(item order by sort_at desc, id desc), '[]'::jsonb)
  into rows
  from (
    select
      jsonb_build_object(
        'id', m.id,
        'org_id', m.org_id,
        'mailbox_account_id', m.mailbox_account_id,
        'subject', m.subject,
        'from_address', m.from_address,
        'from_name', m.from_name,
        'preview_text', m.preview_text,
        'body_text', m.body_text,
        'received_at', m.received_at,
        'sent_at', m.sent_at,
        'created_at', m.created_at,
        'direction', m.direction,
        'status', m.status,
        'is_owner', true
      ) as item,
      coalesce(m.received_at, m.created_at) as sort_at,
      m.id
    from public.email_messages m
    where m.org_id = p_org_id
      and m.owner_membership_id = membership_row.id
      and m.deleted_at is null
      and (
        p_cursor_received_at is null
        or p_cursor_id is null
        or coalesce(m.received_at, m.created_at) < p_cursor_received_at
        or (
          coalesce(m.received_at, m.created_at) = p_cursor_received_at
          and m.id < p_cursor_id
        )
      )
    order by coalesce(m.received_at, m.created_at) desc, m.id desc
    limit lim
  ) page;

  return rows;
end;
$$;

revoke all on function public.list_my_email_messages(uuid, integer, timestamptz, uuid)
  from public, anon;
grant execute on function public.list_my_email_messages(uuid, integer, timestamptz, uuid)
  to authenticated;

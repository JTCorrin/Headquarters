-- Mail campaigns: catalog, audience tags, recipient snapshot, send helpers.
-- Sends via a selected personal mailbox_accounts row; paced by daily quota.

set search_path = public, extensions, pg_catalog;

-- ---------------------------------------------------------------------------
-- campaigns
-- ---------------------------------------------------------------------------

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  name text not null check (char_length(name) between 1 and 200),
  status text not null default 'draft',
  template_id uuid,
  mailbox_id uuid,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 2000),
  constraint campaigns_org_id_id_key unique (org_id, id),
  constraint campaigns_status_check
    check (status in (
      'draft', 'scheduled', 'sending', 'completed', 'cancelled', 'failed'
    )),
  constraint campaigns_org_template_fk
    foreign key (org_id, template_id)
    references public.email_templates (org_id, id)
    on delete set null (template_id),
  constraint campaigns_org_mailbox_fk
    foreign key (org_id, mailbox_id)
    references public.mailbox_accounts (org_id, id)
    on delete set null (mailbox_id)
);

create unique index campaigns_org_name_uidx
  on public.campaigns (org_id, lower(name))
  where deleted_at is null;

create index campaigns_org_status_idx
  on public.campaigns (org_id, status)
  where deleted_at is null;

create index campaigns_org_created_idx
  on public.campaigns (org_id, created_at desc, id desc)
  where deleted_at is null;

create index campaigns_due_send_idx
  on public.campaigns (status, scheduled_at, id)
  where deleted_at is null
    and status in ('scheduled', 'sending');

create trigger campaigns_stamp_business_row
before insert or update on public.campaigns
for each row execute function private.stamp_business_row();

alter table public.campaigns enable row level security;

create policy campaigns_select_member
on public.campaigns
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
);

create policy campaigns_insert_member
on public.campaigns
for insert
to authenticated
with check (
  private.has_org_role(org_id, array['owner', 'admin', 'member'])
  and created_by = auth.uid()
  and updated_by = auth.uid()
);

create policy campaigns_update_member
on public.campaigns
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

revoke all on table public.campaigns from public, anon, authenticated;

grant select on table public.campaigns to authenticated;
grant insert (
  org_id,
  name,
  status,
  template_id,
  mailbox_id,
  scheduled_at
) on table public.campaigns to authenticated;
grant update (
  name,
  status,
  template_id,
  mailbox_id,
  scheduled_at,
  started_at,
  completed_at,
  last_error,
  deleted_at
) on table public.campaigns to authenticated;

create or replace function public.soft_delete_campaign(
  p_campaign_id uuid,
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
  campaign_row public.campaigns;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into campaign_row
  from public.campaigns
  where campaigns.id = p_campaign_id
    and campaigns.org_id = p_org_id
    and campaigns.deleted_at is null
  for update;

  if not found then
    raise exception 'Campaign not found'
      using errcode = 'P0002';
  end if;

  if campaign_row.version is distinct from p_expected_version then
    raise exception 'Campaign version conflict'
      using errcode = 'P0001';
  end if;

  if campaign_row.status in ('sending', 'scheduled') then
    raise exception 'Cancel the campaign before deleting it'
      using errcode = '22023';
  end if;

  update public.campaigns
  set
    deleted_at = now(),
    updated_by = actor_id
  where campaigns.id = campaign_row.id;
end;
$$;

revoke all on function public.soft_delete_campaign(uuid, uuid, integer)
  from public, anon;
grant execute on function public.soft_delete_campaign(uuid, uuid, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- campaign audience definition
-- ---------------------------------------------------------------------------

create table public.campaign_audience_tags (
  campaign_id uuid not null,
  org_id uuid not null,
  tag_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (campaign_id, tag_id),
  constraint campaign_audience_tags_campaign_fk
    foreign key (org_id, campaign_id)
    references public.campaigns (org_id, id)
    on delete cascade,
  constraint campaign_audience_tags_tag_fk
    foreign key (org_id, tag_id)
    references public.tags (org_id, id)
    on delete cascade
);

create index campaign_audience_tags_org_tag_idx
  on public.campaign_audience_tags (org_id, tag_id);

alter table public.campaign_audience_tags enable row level security;

create policy campaign_audience_tags_select_member
on public.campaign_audience_tags
for select
to authenticated
using (
  private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
);

create policy campaign_audience_tags_insert_member
on public.campaign_audience_tags
for insert
to authenticated
with check (
  private.has_org_role(org_id, array['owner', 'admin', 'member'])
);

create policy campaign_audience_tags_delete_member
on public.campaign_audience_tags
for delete
to authenticated
using (
  private.has_org_role(org_id, array['owner', 'admin', 'member'])
);

revoke all on table public.campaign_audience_tags from public, anon, authenticated;
grant select on table public.campaign_audience_tags to authenticated;
grant insert (campaign_id, org_id, tag_id) on table public.campaign_audience_tags to authenticated;
grant delete on table public.campaign_audience_tags to authenticated;

create table public.campaign_audience_entity_types (
  campaign_id uuid not null,
  org_id uuid not null,
  entity_type text not null,
  created_at timestamptz not null default now(),
  primary key (campaign_id, entity_type),
  constraint campaign_audience_entity_types_campaign_fk
    foreign key (org_id, campaign_id)
    references public.campaigns (org_id, id)
    on delete cascade,
  constraint campaign_audience_entity_types_check
    check (entity_type in ('lead', 'contact', 'client'))
);

alter table public.campaign_audience_entity_types enable row level security;

create policy campaign_audience_entity_types_select_member
on public.campaign_audience_entity_types
for select
to authenticated
using (
  private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
);

create policy campaign_audience_entity_types_insert_member
on public.campaign_audience_entity_types
for insert
to authenticated
with check (
  private.has_org_role(org_id, array['owner', 'admin', 'member'])
);

create policy campaign_audience_entity_types_delete_member
on public.campaign_audience_entity_types
for delete
to authenticated
using (
  private.has_org_role(org_id, array['owner', 'admin', 'member'])
);

revoke all on table public.campaign_audience_entity_types from public, anon, authenticated;
grant select on table public.campaign_audience_entity_types to authenticated;
grant insert (campaign_id, org_id, entity_type)
  on table public.campaign_audience_entity_types to authenticated;
grant delete on table public.campaign_audience_entity_types to authenticated;

-- ---------------------------------------------------------------------------
-- campaign_recipients (frozen at launch)
-- ---------------------------------------------------------------------------

create table public.campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  campaign_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  entity_type text not null,
  entity_id uuid not null,
  to_email extensions.citext not null,
  to_name text check (to_name is null or char_length(to_name) between 1 and 200),
  status text not null default 'pending',
  error text check (error is null or char_length(error) <= 2000),
  sent_at timestamptz,
  email_message_id uuid,
  constraint campaign_recipients_org_campaign_fk
    foreign key (org_id, campaign_id)
    references public.campaigns (org_id, id)
    on delete cascade,
  constraint campaign_recipients_entity_type_check
    check (entity_type in ('lead', 'contact', 'client')),
  constraint campaign_recipients_status_check
    check (status in ('pending', 'sent', 'skipped', 'failed')),
  constraint campaign_recipients_campaign_email_uidx
    unique (campaign_id, to_email)
);

create index campaign_recipients_campaign_status_idx
  on public.campaign_recipients (campaign_id, status, created_at, id);

create index campaign_recipients_org_campaign_idx
  on public.campaign_recipients (org_id, campaign_id);

alter table public.campaign_recipients enable row level security;

create policy campaign_recipients_select_member
on public.campaign_recipients
for select
to authenticated
using (
  private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
);

-- Mutations are service_role / security-definer RPCs only.
revoke all on table public.campaign_recipients from public, anon, authenticated;
grant select on table public.campaign_recipients to authenticated;

-- ---------------------------------------------------------------------------
-- Audience resolve helpers
-- ---------------------------------------------------------------------------

create or replace function private.campaign_resolve_entity_email(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
returns table (to_email extensions.citext, to_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_entity_type = 'contact' then
    return query
    select c.primary_email, c.display_name
    from public.contacts c
    where c.org_id = p_org_id
      and c.id = p_entity_id
      and c.deleted_at is null;
    return;
  end if;

  if p_entity_type = 'lead' then
    return query
    select coalesce(
             nullif(trim(l.primary_email::text), '')::extensions.citext,
             ct.primary_email
           ),
           coalesce(nullif(trim(l.name), ''), ct.display_name)
    from public.leads l
    left join public.contacts ct
      on ct.org_id = l.org_id
     and ct.id = l.contact_id
     and ct.deleted_at is null
    where l.org_id = p_org_id
      and l.id = p_entity_id
      and l.deleted_at is null;
    return;
  end if;

  if p_entity_type = 'client' then
    return query
    select coalesce(
             nullif(trim(cl.primary_email::text), '')::extensions.citext,
             (
               select ct.primary_email
               from public.client_contacts cc
               join public.contacts ct
                 on ct.org_id = cc.org_id
                and ct.id = cc.contact_id
                and ct.deleted_at is null
               where cc.org_id = cl.org_id
                 and cc.client_id = cl.id
                 and cc.deleted_at is null
               order by cc.is_primary desc, cc.created_at asc
               limit 1
             )
           ),
           cl.name
    from public.clients cl
    where cl.org_id = p_org_id
      and cl.id = p_entity_id
      and cl.deleted_at is null;
    return;
  end if;
end;
$$;

revoke all on function private.campaign_resolve_entity_email(uuid, text, uuid)
  from public, anon, authenticated;

create or replace function public.resolve_campaign_audience(
  p_org_id uuid,
  p_tag_ids uuid[],
  p_entity_types text[],
  p_limit integer default 500
)
returns table (
  entity_type text,
  entity_id uuid,
  to_email extensions.citext,
  to_name text,
  skip_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tag_ids uuid[] := coalesce(p_tag_ids, array[]::uuid[]);
  entity_types text[] := coalesce(p_entity_types, array['lead', 'contact', 'client']::text[]);
  max_rows integer := greatest(1, least(coalesce(p_limit, 500), 500));
begin
  if auth.uid() is null and current_user not in ('service_role', 'postgres') then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if auth.uid() is not null
     and not private.has_org_role(
       p_org_id,
       array['owner', 'admin', 'member', 'readonly']
     )
  then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  if cardinality(tag_ids) = 0 then
    return;
  end if;

  return query
  with tagged as (
    select distinct a.entity_type, a.entity_id
    from public.tag_assignments a
    join public.tags t
      on t.id = a.tag_id
     and t.org_id = a.org_id
     and t.deleted_at is null
    where a.org_id = p_org_id
      and a.tag_id = any (tag_ids)
      and a.entity_type = any (entity_types)
  ),
  resolved as (
    select
      tg.entity_type,
      tg.entity_id,
      r.to_email,
      r.to_name
    from tagged tg
    left join lateral private.campaign_resolve_entity_email(
      p_org_id, tg.entity_type, tg.entity_id
    ) r on true
  ),
  ranked as (
    select
      resolved.entity_type,
      resolved.entity_id,
      resolved.to_email,
      resolved.to_name,
      case
        when resolved.to_email is null
          or length(trim(resolved.to_email::text)) = 0
          then 'missing_email'
        when position('@' in resolved.to_email::text) = 0
          then 'invalid_email'
        else null
      end as skip_reason,
      row_number() over (
        partition by lower(coalesce(resolved.to_email::text, ''))
        order by resolved.entity_type, resolved.entity_id
      ) as email_rank
    from resolved
  )
  select
    ranked.entity_type,
    ranked.entity_id,
    ranked.to_email,
    ranked.to_name,
    case
      when ranked.skip_reason is not null then ranked.skip_reason
      when ranked.to_email is not null
           and ranked.email_rank > 1
           and ranked.skip_reason is null
        then 'duplicate_email'
      else null
    end as skip_reason
  from ranked
  order by ranked.entity_type, ranked.entity_id
  limit max_rows;
end;
$$;

revoke all on function public.resolve_campaign_audience(uuid, uuid[], text[], integer)
  from public, anon;
grant execute on function public.resolve_campaign_audience(uuid, uuid[], text[], integer)
  to authenticated, service_role;

-- Replace audience definition for a draft campaign.
create or replace function public.replace_campaign_audience(
  p_campaign_id uuid,
  p_org_id uuid,
  p_tag_ids uuid[],
  p_entity_types text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  campaign_row public.campaigns;
  tag_ids uuid[] := coalesce(p_tag_ids, array[]::uuid[]);
  entity_types text[] := coalesce(p_entity_types, array['lead', 'contact', 'client']::text[]);
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into campaign_row
  from public.campaigns
  where id = p_campaign_id
    and org_id = p_org_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'Campaign not found'
      using errcode = 'P0002';
  end if;

  if campaign_row.status <> 'draft' then
    raise exception 'Audience can only be changed on draft campaigns'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(entity_types) as et(t)
    where et.t not in ('lead', 'contact', 'client')
  ) then
    raise exception 'Invalid entity type'
      using errcode = '22023';
  end if;

  if cardinality(tag_ids) > 0 then
    if exists (
      select 1
      from unnest(tag_ids) as tid(id)
      left join public.tags t
        on t.id = tid.id
       and t.org_id = p_org_id
       and t.deleted_at is null
      where t.id is null
    ) then
      raise exception 'One or more tags were not found'
        using errcode = 'P0002';
    end if;
  end if;

  delete from public.campaign_audience_tags
  where campaign_id = p_campaign_id and org_id = p_org_id;

  delete from public.campaign_audience_entity_types
  where campaign_id = p_campaign_id and org_id = p_org_id;

  insert into public.campaign_audience_tags (campaign_id, org_id, tag_id)
  select p_campaign_id, p_org_id, tid.id
  from unnest(tag_ids) as tid(id);

  insert into public.campaign_audience_entity_types (campaign_id, org_id, entity_type)
  select p_campaign_id, p_org_id, et.t
  from unnest(entity_types) as et(t);

  update public.campaigns
  set updated_by = actor_id
  where id = p_campaign_id;
end;
$$;

revoke all on function public.replace_campaign_audience(uuid, uuid, uuid[], text[])
  from public, anon;
grant execute on function public.replace_campaign_audience(uuid, uuid, uuid[], text[])
  to authenticated;

-- Launch: freeze recipients and move to scheduled/sending.
create or replace function public.launch_campaign(
  p_campaign_id uuid,
  p_org_id uuid,
  p_expected_version integer,
  p_send_immediately boolean default true
)
returns public.campaigns
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  campaign_row public.campaigns;
  tag_ids uuid[];
  entity_types text[];
  sendable_count integer := 0;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into campaign_row
  from public.campaigns
  where id = p_campaign_id
    and org_id = p_org_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'Campaign not found'
      using errcode = 'P0002';
  end if;

  if campaign_row.version is distinct from p_expected_version then
    raise exception 'Campaign version conflict'
      using errcode = 'P0001';
  end if;

  if campaign_row.status <> 'draft'
     and not (campaign_row.status = 'scheduled' and p_send_immediately)
  then
    raise exception 'Campaign cannot be launched from status %', campaign_row.status
      using errcode = '22023';
  end if;

  if campaign_row.template_id is null then
    raise exception 'Campaign requires a template'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.email_templates t
    where t.org_id = p_org_id
      and t.id = campaign_row.template_id
      and t.deleted_at is null
      and t.status = 'active'
  ) then
    raise exception 'Campaign template must be active'
      using errcode = '22023';
  end if;

  if campaign_row.mailbox_id is null then
    raise exception 'Campaign requires a mailbox'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.mailbox_accounts m
    where m.org_id = p_org_id
      and m.id = campaign_row.mailbox_id
      and m.deleted_at is null
      and m.status in ('active', 'pending', 'error')
  ) then
    raise exception 'Campaign mailbox is not available'
      using errcode = '22023';
  end if;

  select coalesce(array_agg(tag_id), array[]::uuid[])
  into tag_ids
  from public.campaign_audience_tags
  where campaign_id = p_campaign_id and org_id = p_org_id;

  select coalesce(array_agg(entity_type), array[]::text[])
  into entity_types
  from public.campaign_audience_entity_types
  where campaign_id = p_campaign_id and org_id = p_org_id;

  if cardinality(tag_ids) = 0 then
    raise exception 'Campaign requires at least one audience tag'
      using errcode = '22023';
  end if;

  if cardinality(entity_types) = 0 then
    entity_types := array['lead', 'contact', 'client']::text[];
  end if;

  -- Clear any prior snapshot (re-launch from scheduled).
  delete from public.campaign_recipients
  where campaign_id = p_campaign_id and org_id = p_org_id;

  insert into public.campaign_recipients (
    org_id,
    campaign_id,
    entity_type,
    entity_id,
    to_email,
    to_name,
    status,
    error
  )
  select
    p_org_id,
    p_campaign_id,
    r.entity_type,
    r.entity_id,
    case
      when r.skip_reason is null then r.to_email
      else (
        'skip+' || r.entity_type || '+' || r.entity_id::text
        || '+' || coalesce(r.skip_reason, 'unknown')
        || '@campaign.invalid'
      )::extensions.citext
    end,
    r.to_name,
    case when r.skip_reason is null then 'pending' else 'skipped' end,
    r.skip_reason
  from public.resolve_campaign_audience(p_org_id, tag_ids, entity_types, 500) r
  where r.skip_reason is null
     or r.skip_reason in ('missing_email', 'invalid_email', 'duplicate_email');

  select count(*) into sendable_count
  from public.campaign_recipients
  where campaign_id = p_campaign_id
    and org_id = p_org_id
    and status = 'pending';

  if sendable_count = 0 then
    raise exception 'Campaign has no sendable recipients'
      using errcode = '22023';
  end if;

  if not p_send_immediately and campaign_row.scheduled_at is not null
     and campaign_row.scheduled_at > now()
  then
    update public.campaigns
    set
      status = 'scheduled',
      last_error = null,
      updated_by = actor_id
    where id = p_campaign_id
    returning * into campaign_row;
  else
    update public.campaigns
    set
      status = 'sending',
      started_at = coalesce(started_at, now()),
      scheduled_at = coalesce(scheduled_at, now()),
      last_error = null,
      updated_by = actor_id
    where id = p_campaign_id
    returning * into campaign_row;
  end if;

  return campaign_row;
end;
$$;

revoke all on function public.launch_campaign(uuid, uuid, integer, boolean)
  from public, anon;
grant execute on function public.launch_campaign(uuid, uuid, integer, boolean)
  to authenticated;

create or replace function public.cancel_campaign(
  p_campaign_id uuid,
  p_org_id uuid,
  p_expected_version integer
)
returns public.campaigns
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  campaign_row public.campaigns;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into campaign_row
  from public.campaigns
  where id = p_campaign_id
    and org_id = p_org_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'Campaign not found'
      using errcode = 'P0002';
  end if;

  if campaign_row.version is distinct from p_expected_version then
    raise exception 'Campaign version conflict'
      using errcode = 'P0001';
  end if;

  if campaign_row.status not in ('scheduled', 'sending') then
    raise exception 'Only scheduled or sending campaigns can be cancelled'
      using errcode = '22023';
  end if;

  update public.campaigns
  set
    status = 'cancelled',
    completed_at = now(),
    updated_by = actor_id
  where id = p_campaign_id
  returning * into campaign_row;

  return campaign_row;
end;
$$;

revoke all on function public.cancel_campaign(uuid, uuid, integer)
  from public, anon;
grant execute on function public.cancel_campaign(uuid, uuid, integer)
  to authenticated;

-- Service-role: claim due campaigns and pending recipients.
create or replace function public.claim_due_campaigns(p_limit integer default 10)
returns setof public.campaigns
language plpgsql
security definer
set search_path = ''
as $$
declare
  max_rows integer := greatest(1, least(coalesce(p_limit, 10), 50));
begin
  return query
  with due as (
    select c.id
    from public.campaigns c
    where c.deleted_at is null
      and (
        (c.status = 'scheduled' and c.scheduled_at is not null and c.scheduled_at <= now())
        or c.status = 'sending'
      )
    order by coalesce(c.scheduled_at, c.created_at), c.id
    limit max_rows
    for update skip locked
  ),
  promoted as (
    update public.campaigns c
    set
      status = 'sending',
      started_at = coalesce(c.started_at, now())
    from due
    where c.id = due.id
      and c.status = 'scheduled'
    returning c.id
  )
  select c.*
  from public.campaigns c
  where c.id in (select id from due);
end;
$$;

revoke all on function public.claim_due_campaigns(integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_campaigns(integer)
  to service_role;

create or replace function public.claim_campaign_recipients(
  p_campaign_id uuid,
  p_org_id uuid,
  p_limit integer default 20
)
returns setof public.campaign_recipients
language plpgsql
security definer
set search_path = ''
as $$
declare
  max_rows integer := greatest(1, least(coalesce(p_limit, 20), 50));
begin
  return query
  with due as (
    select r.id
    from public.campaign_recipients r
    where r.org_id = p_org_id
      and r.campaign_id = p_campaign_id
      and r.status = 'pending'
    order by r.created_at, r.id
    limit max_rows
    for update skip locked
  )
  select r.*
  from public.campaign_recipients r
  join due on due.id = r.id;
end;
$$;

revoke all on function public.claim_campaign_recipients(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_campaign_recipients(uuid, uuid, integer)
  to service_role;

create or replace function public.mark_campaign_recipient_result(
  p_recipient_id uuid,
  p_org_id uuid,
  p_status text,
  p_error text default null,
  p_email_message_id uuid default null
)
returns public.campaign_recipients
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_row public.campaign_recipients;
begin
  if p_status not in ('sent', 'skipped', 'failed') then
    raise exception 'Invalid recipient status'
      using errcode = '22023';
  end if;

  update public.campaign_recipients
  set
    status = p_status,
    error = nullif(trim(coalesce(p_error, '')), ''),
    email_message_id = coalesce(p_email_message_id, email_message_id),
    sent_at = case when p_status = 'sent' then now() else sent_at end,
    updated_at = now()
  where id = p_recipient_id
    and org_id = p_org_id
    and status = 'pending'
  returning * into recipient_row;

  if not found then
    select * into recipient_row
    from public.campaign_recipients
    where id = p_recipient_id and org_id = p_org_id;
  end if;

  return recipient_row;
end;
$$;

revoke all on function public.mark_campaign_recipient_result(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.mark_campaign_recipient_result(uuid, uuid, text, text, uuid)
  to service_role;

create or replace function public.finalize_campaign_if_done(
  p_campaign_id uuid,
  p_org_id uuid
)
returns public.campaigns
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign_row public.campaigns;
  pending_count integer;
  failed_count integer;
  sent_count integer;
begin
  select count(*) filter (where status = 'pending'),
         count(*) filter (where status = 'failed'),
         count(*) filter (where status = 'sent')
  into pending_count, failed_count, sent_count
  from public.campaign_recipients
  where campaign_id = p_campaign_id
    and org_id = p_org_id;

  select * into campaign_row
  from public.campaigns
  where id = p_campaign_id
    and org_id = p_org_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'Campaign not found'
      using errcode = 'P0002';
  end if;

  if campaign_row.status = 'cancelled' then
    return campaign_row;
  end if;

  if pending_count > 0 then
    return campaign_row;
  end if;

  update public.campaigns
  set
    status = case
      when sent_count = 0 and failed_count > 0 then 'failed'
      else 'completed'
    end,
    completed_at = now(),
    last_error = case
      when sent_count = 0 and failed_count > 0 then 'All recipients failed'
      else last_error
    end
  where id = p_campaign_id
  returning * into campaign_row;

  return campaign_row;
end;
$$;

revoke all on function public.finalize_campaign_if_done(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_campaign_if_done(uuid, uuid)
  to service_role;

-- Quota helpers for campaign worker.
create or replace function public.campaign_mailbox_quota_remaining(
  p_org_id uuid,
  p_mailbox_id uuid
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  used integer := 0;
  lim integer;
begin
  lim := private.email_send_quota_limit();
  select coalesce(q.sent_count, 0)
  into used
  from public.email_send_quota_usage q
  where q.org_id = p_org_id
    and q.mailbox_account_id = p_mailbox_id
    and q.usage_date = (timezone('utc', now()))::date;

  return greatest(0, lim - coalesce(used, 0));
end;
$$;

revoke all on function public.campaign_mailbox_quota_remaining(uuid, uuid)
  from public, anon;
grant execute on function public.campaign_mailbox_quota_remaining(uuid, uuid)
  to authenticated, service_role;

create or replace function public.campaign_consume_send_quota(
  p_org_id uuid,
  p_mailbox_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_email_send_quota(p_org_id, p_mailbox_id);
  perform private.record_email_send(p_org_id, p_mailbox_id);
end;
$$;

revoke all on function public.campaign_consume_send_quota(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.campaign_consume_send_quota(uuid, uuid)
  to service_role;

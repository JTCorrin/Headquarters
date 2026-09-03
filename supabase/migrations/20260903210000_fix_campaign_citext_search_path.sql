-- Fix bare ::citext casts under set search_path = '' (citext lives in extensions).
-- Safe to re-run: create or replace only.

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

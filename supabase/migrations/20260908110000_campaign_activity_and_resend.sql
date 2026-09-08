-- Durable claims prevent overlapping worker ticks from sending the same recipient.
alter table public.campaign_recipients add column claimed_at timestamptz;
alter table public.campaigns add column last_worker_at timestamptz;
alter table public.campaigns add column next_attempt_at timestamptz;

create table public.campaign_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  campaign_id uuid not null,
  created_at timestamptz not null default now(),
  level text not null check (level in ('info', 'warning', 'error')),
  message text not null check (char_length(message) between 1 and 1000),
  foreign key (org_id, campaign_id) references public.campaigns(org_id, id) on delete cascade
);
create index campaign_events_recent_idx on public.campaign_events(org_id, campaign_id, created_at desc);
alter table public.campaign_events enable row level security;
create policy campaign_events_read_member on public.campaign_events for select to authenticated
using (private.has_org_role(org_id, array['owner','admin','member','readonly']) and exists (
  select 1 from public.campaigns c where c.id = campaign_id and c.org_id = campaign_events.org_id
    and c.deleted_at is null
));
revoke all on public.campaign_events from public, anon, authenticated;
grant select on public.campaign_events to authenticated;
grant all on public.campaign_events to service_role;

create function private.log_campaign_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status is distinct from new.status then
    insert into public.campaign_events(org_id,campaign_id,level,message)
    values(new.org_id,new.id,case when new.status = 'failed' then 'error' else 'info' end,
      case new.status
        when 'scheduled' then 'Campaign scheduled. Waiting for its send time.'
        when 'sending' then 'Campaign queued for the sending worker.'
        when 'completed' then 'Campaign finished. Review recipient results below.'
        when 'cancelled' then 'Campaign cancelled. Messages already accepted by the mail server cannot be recalled.'
        when 'failed' then 'Campaign stopped because sending failed.'
        else 'Campaign status changed to ' || new.status || '.' end);
  end if;
  return new;
end; $$;
create trigger campaign_status_event after update of status on public.campaigns
for each row execute function private.log_campaign_status();

create or replace function public.claim_due_campaigns(p_limit integer default 10)
returns setof public.campaigns language plpgsql security definer set search_path = '' as $$
begin
  return query
  with due as (
    select c.id from public.campaigns c
    where c.deleted_at is null and (c.next_attempt_at is null or c.next_attempt_at <= now())
      and ((c.status = 'scheduled' and c.scheduled_at <= now()) or c.status = 'sending')
    order by coalesce(c.last_worker_at,c.scheduled_at,c.created_at),c.id
    limit greatest(1,least(coalesce(p_limit,10),50)) for update skip locked
  )
  update public.campaigns c set status = 'sending', started_at = coalesce(c.started_at,now()),
    last_worker_at = now(), next_attempt_at = null,
    last_error = case when c.next_attempt_at is not null then null else c.last_error end
  from due where c.id = due.id returning c.*;
end; $$;

create or replace function public.claim_campaign_recipients(p_campaign_id uuid,p_org_id uuid,p_limit integer default 20)
returns setof public.campaign_recipients language plpgsql security definer set search_path = '' as $$
begin
  -- A crashed SMTP attempt has an unknown outcome. Never automatically send it again.
  update public.campaign_recipients set status = 'failed', updated_at = now(),
    error = 'Delivery outcome unknown after the worker stopped. Check the sending mailbox before resending.'
  where org_id = p_org_id and campaign_id = p_campaign_id and status = 'pending'
    and claimed_at < now() - interval '10 minutes';
  return query
  with due as (
    select r.id from public.campaign_recipients r
    where r.org_id = p_org_id and r.campaign_id = p_campaign_id
      and r.status = 'pending' and r.claimed_at is null
      and exists(select 1 from public.campaigns c where c.id = p_campaign_id
        and c.org_id = p_org_id and c.status = 'sending' and c.deleted_at is null)
    order by r.created_at,r.id limit greatest(1,least(coalesce(p_limit,20),50))
    for update skip locked
  )
  update public.campaign_recipients r set claimed_at = now(), updated_at = now()
  from due where r.id = due.id returning r.*;
end; $$;

-- Resending creates a separate editable draft, never resets delivery history or sends mail.
create function public.resend_campaign(p_campaign_id uuid,p_org_id uuid,p_expected_version integer)
returns public.campaigns language plpgsql security definer set search_path = '' as $$
declare
  original public.campaigns;
  copied public.campaigns;
  actor uuid := auth.uid();
  attempt integer := 1;
  draft_name text;
begin
  if actor is null or not private.has_org_role(p_org_id,array['owner','admin','member']) then
    raise exception 'This action is not permitted' using errcode = '42501';
  end if;
  select * into original from public.campaigns
    where id = p_campaign_id and org_id = p_org_id and deleted_at is null for update;
  if not found then raise exception 'Campaign not found' using errcode = 'P0002'; end if;
  if original.version is distinct from p_expected_version then
    raise exception 'Campaign version conflict' using errcode = 'P0001';
  end if;
  if original.status not in ('completed','failed','cancelled') then
    raise exception 'Finish or cancel this campaign before preparing a resend' using errcode = '22023';
  end if;
  loop
    draft_name := left(original.name,170) || ' (resend ' || attempt::text || ')';
    exit when not exists(select 1 from public.campaigns where org_id = p_org_id
      and deleted_at is null and lower(name) = lower(draft_name));
    attempt := attempt + 1;
  end loop;
  insert into public.campaigns(org_id,name,template_id,mailbox_id,created_by,updated_by)
  values(p_org_id,draft_name,
    original.template_id,original.mailbox_id,actor,actor) returning * into copied;
  insert into public.campaign_audience_tags(org_id,campaign_id,tag_id)
    select org_id,copied.id,tag_id from public.campaign_audience_tags
    where org_id = p_org_id and campaign_id = p_campaign_id;
  insert into public.campaign_audience_entity_types(org_id,campaign_id,entity_type)
    select org_id,copied.id,entity_type from public.campaign_audience_entity_types
    where org_id = p_org_id and campaign_id = p_campaign_id;
  insert into public.campaign_events(org_id,campaign_id,level,message)
    values(p_org_id,p_campaign_id,'info','A new draft was prepared for resending. No emails were sent by this action.'),
      (p_org_id,copied.id,'info','Draft copied from an earlier campaign. Review the current audience before launching.');
  -- Bump the source version so duplicate clicks with the same version cannot create two drafts.
  update public.campaigns set updated_by = actor where id = p_campaign_id and org_id = p_org_id;
  return copied;
end; $$;
revoke all on function public.resend_campaign(uuid,uuid,integer) from public,anon;
grant execute on function public.resend_campaign(uuid,uuid,integer) to authenticated;

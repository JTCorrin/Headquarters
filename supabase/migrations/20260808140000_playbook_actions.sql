-- Playbook Phase D: notification kind, send ledger, system timeline/notify RPCs.

set search_path = public, extensions, pg_catalog;

alter table public.user_notifications
  drop constraint if exists user_notifications_kind_check;

alter table public.user_notifications
  add constraint user_notifications_kind_check
  check (kind in ('email.received', 'timeline.mention', 'playbook.alert'));

alter table public.user_notifications
  drop constraint if exists user_notifications_source_type_check;

alter table public.user_notifications
  add constraint user_notifications_source_type_check
  check (source_type in ('email_message', 'timeline_event', 'playbook_run'));

create table public.playbook_send_ledger (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  run_id uuid not null,
  node_id text not null,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  constraint playbook_send_ledger_run_fk
    foreign key (org_id, run_id)
    references public.playbook_runs (org_id, id)
    on delete cascade,
  constraint playbook_send_ledger_dedupe_uidx unique (org_id, dedupe_key)
);

create index playbook_send_ledger_run_idx
  on public.playbook_send_ledger (org_id, run_id);

alter table public.playbook_send_ledger enable row level security;
revoke all on table public.playbook_send_ledger from public, anon, authenticated;

-- System timeline note for playbook runs (service_role only).
create or replace function public.create_playbook_timeline_note(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_title text,
  p_body text default null,
  p_payload jsonb default '{}'::jsonb
)
returns public.timeline_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_row public.timeline_events;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if p_entity_type not in ('contact', 'lead', 'client', 'quote', 'invoice', 'bill') then
    raise exception 'Invalid entity type' using errcode = '22023';
  end if;

  if p_title is null or char_length(btrim(p_title)) < 1 or char_length(btrim(p_title)) > 200 then
    raise exception 'Invalid title' using errcode = '22023';
  end if;

  insert into public.timeline_events (
    org_id,
    entity_type,
    entity_id,
    kind,
    title,
    body,
    actor_type,
    actor_id,
    source_type,
    source_id,
    payload,
    occurred_at
  ) values (
    p_org_id,
    p_entity_type,
    p_entity_id,
    'note',
    btrim(p_title),
    nullif(p_body, ''),
    'system',
    null,
    'playbook',
    null,
    coalesce(p_payload, '{}'::jsonb),
    now()
  )
  returning * into created_row;

  return created_row;
end;
$$;

revoke all on function public.create_playbook_timeline_note(uuid, text, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_playbook_timeline_note(uuid, text, uuid, text, text, jsonb)
  to service_role;

-- p_source_id lets each (run, node, recipient) notify uniquely; defaults to run id.
create or replace function public.create_playbook_notification(
  p_org_id uuid,
  p_recipient_membership_id uuid,
  p_run_id uuid,
  p_title text,
  p_body text default null,
  p_payload jsonb default '{}'::jsonb,
  p_source_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if jsonb_typeof(payload) <> 'object' then
    payload := '{}'::jsonb;
  end if;
  payload := payload || jsonb_build_object('run_id', p_run_id);

  return private.create_user_notification(
    p_org_id,
    p_recipient_membership_id,
    'playbook.alert',
    'playbook_run',
    coalesce(p_source_id, p_run_id),
    p_title,
    p_body,
    payload
  );
end;
$$;

revoke all on function public.create_playbook_notification(uuid, uuid, uuid, text, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.create_playbook_notification(uuid, uuid, uuid, text, text, jsonb, uuid)
  to service_role;

-- Resolve a primary email for common CRM entities (service_role).
create or replace function public.resolve_playbook_entity_email(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  email text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if p_entity_type = 'contact' then
    select contacts.primary_email into email
    from public.contacts
    where contacts.id = p_entity_id
      and contacts.org_id = p_org_id
      and contacts.deleted_at is null;
  elsif p_entity_type = 'client' then
    select clients.primary_email into email
    from public.clients
    where clients.id = p_entity_id
      and clients.org_id = p_org_id
      and clients.deleted_at is null;
  elsif p_entity_type = 'lead' then
    select coalesce(contacts.primary_email, leads.primary_email) into email
    from public.leads
    left join public.contacts
      on contacts.id = leads.contact_id
     and contacts.org_id = leads.org_id
     and contacts.deleted_at is null
    where leads.id = p_entity_id
      and leads.org_id = p_org_id
      and leads.deleted_at is null;
  elsif p_entity_type = 'invoice' then
    select coalesce(contacts.primary_email, clients.primary_email) into email
    from public.invoices
    left join public.clients
      on clients.id = invoices.client_id
     and clients.org_id = invoices.org_id
     and clients.deleted_at is null
    left join public.contacts
      on contacts.id = invoices.contact_id
     and contacts.org_id = invoices.org_id
     and contacts.deleted_at is null
    where invoices.id = p_entity_id
      and invoices.org_id = p_org_id
      and invoices.deleted_at is null;
  elsif p_entity_type = 'quote' then
    select coalesce(contacts.primary_email, clients.primary_email) into email
    from public.quotes
    left join public.clients
      on clients.id = quotes.client_id
     and clients.org_id = quotes.org_id
     and clients.deleted_at is null
    left join public.contacts
      on contacts.id = quotes.contact_id
     and contacts.org_id = quotes.org_id
     and contacts.deleted_at is null
    where quotes.id = p_entity_id
      and quotes.org_id = p_org_id
      and quotes.deleted_at is null;
  end if;

  return nullif(btrim(email), '');
end;
$$;

revoke all on function public.resolve_playbook_entity_email(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_playbook_entity_email(uuid, text, uuid)
  to service_role;

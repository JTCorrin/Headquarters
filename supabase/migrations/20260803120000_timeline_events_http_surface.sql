-- Timeline HTTP surface: expand entity targets for profile rails; note create via RPC.

alter table public.timeline_events
  drop constraint timeline_events_entity_type_check;

alter table public.timeline_events
  add constraint timeline_events_entity_type_check
  check (
    entity_type in (
      'contact',
      'lead',
      'client',
      'quote',
      'invoice',
      'bill'
    )
  );

-- Append-only composer notes (keeps table INSERT revoked for authenticated; matches share_email pattern).
create or replace function public.create_timeline_event(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_kind text,
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
  actor_id uuid := auth.uid();
  entity_ok boolean := false;
  created_row public.timeline_events;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  if p_entity_type not in ('contact', 'lead', 'client', 'quote', 'invoice', 'bill') then
    raise exception 'Invalid entity type'
      using errcode = '22023';
  end if;

  if p_kind not in (
    'note', 'email', 'call', 'payment', 'document', 'status', 'meeting', 'task'
  ) then
    raise exception 'Invalid timeline kind'
      using errcode = '22023';
  end if;

  if p_title is null or char_length(btrim(p_title)) < 1 or char_length(btrim(p_title)) > 200 then
    raise exception 'Invalid title'
      using errcode = '22023';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid payload'
      using errcode = '22023';
  end if;

  if p_entity_type = 'contact' then
    select exists (
      select 1 from public.contacts
      where contacts.id = p_entity_id
        and contacts.org_id = p_org_id
        and contacts.deleted_at is null
    ) into entity_ok;
  elsif p_entity_type = 'lead' then
    select exists (
      select 1 from public.leads
      where leads.id = p_entity_id
        and leads.org_id = p_org_id
        and leads.deleted_at is null
    ) into entity_ok;
  elsif p_entity_type = 'client' then
    select exists (
      select 1 from public.clients
      where clients.id = p_entity_id
        and clients.org_id = p_org_id
        and clients.deleted_at is null
    ) into entity_ok;
  elsif p_entity_type = 'quote' then
    select exists (
      select 1 from public.quotes
      where quotes.id = p_entity_id
        and quotes.org_id = p_org_id
        and quotes.deleted_at is null
    ) into entity_ok;
  elsif p_entity_type = 'invoice' then
    select exists (
      select 1 from public.invoices
      where invoices.id = p_entity_id
        and invoices.org_id = p_org_id
        and invoices.deleted_at is null
    ) into entity_ok;
  else
    select exists (
      select 1 from public.bills
      where bills.id = p_entity_id
        and bills.org_id = p_org_id
        and bills.deleted_at is null
    ) into entity_ok;
  end if;

  if not entity_ok then
    raise exception 'Entity not found'
      using errcode = 'P0002';
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
    payload
  )
  values (
    p_org_id,
    p_entity_type,
    p_entity_id,
    p_kind,
    btrim(p_title),
    nullif(btrim(coalesce(p_body, '')), ''),
    'user',
    actor_id,
    p_payload
  )
  returning * into created_row;

  return created_row;
end;
$$;

revoke all on function public.create_timeline_event(
  uuid, text, uuid, text, text, text, jsonb
) from public, anon;

grant execute on function public.create_timeline_event(
  uuid, text, uuid, text, text, text, jsonb
) to authenticated;

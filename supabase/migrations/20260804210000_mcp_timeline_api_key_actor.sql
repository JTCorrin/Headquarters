-- MCP-Server: allow timeline actor_type=api_key; extend create_timeline_event for
-- service-role API-key writers; service-role audit helper for task mutations.
-- Plan: PLANS/MCP_V1.md (Buzz nest).

alter table public.timeline_events
  drop constraint timeline_events_actor_type_check;

alter table public.timeline_events
  add constraint timeline_events_actor_type_check
  check (actor_type in ('user', 'agent', 'system', 'integration', 'api_key'));

drop function if exists public.create_timeline_event(
  uuid, text, uuid, text, text, text, jsonb
);

create or replace function public.create_timeline_event(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_kind text,
  p_title text,
  p_body text default null,
  p_payload jsonb default '{}'::jsonb,
  p_actor_type text default null,
  p_actor_id uuid default null
)
returns public.timeline_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  jwt_uid uuid := auth.uid();
  actor_type_resolved text;
  actor_id_resolved uuid;
  key_role text;
  entity_ok boolean := false;
  created_row public.timeline_events;
begin
  if p_actor_type is null then
    if jwt_uid is null then
      raise exception 'Authentication is required'
        using errcode = '42501';
    end if;
    if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
      raise exception 'Forbidden'
        using errcode = '42501';
    end if;
    actor_type_resolved := 'user';
    actor_id_resolved := jwt_uid;
  elsif p_actor_type = 'api_key' then
    if auth.role() is distinct from 'service_role' then
      raise exception 'Forbidden'
        using errcode = '42501';
    end if;
    if p_actor_id is null then
      raise exception 'API key actor_id is required'
        using errcode = '22023';
    end if;
    select api_keys.role
      into key_role
    from public.api_keys
    where api_keys.id = p_actor_id
      and api_keys.org_id = p_org_id
      and api_keys.revoked_at is null
      and api_keys.deleted_at is null
      and (api_keys.expires_at is null or api_keys.expires_at > now());
    if key_role is null then
      raise exception 'API key not found'
        using errcode = 'P0002';
    end if;
    if key_role not in ('owner', 'admin', 'member') then
      raise exception 'Forbidden'
        using errcode = '42501';
    end if;
    actor_type_resolved := 'api_key';
    actor_id_resolved := p_actor_id;
  else
    raise exception 'Invalid actor_type'
      using errcode = '22023';
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
    actor_type_resolved,
    actor_id_resolved,
    p_payload
  )
  returning * into created_row;

  return created_row;
end;
$$;

revoke all on function public.create_timeline_event(
  uuid, text, uuid, text, text, text, jsonb, text, uuid
) from public, anon;

grant execute on function public.create_timeline_event(
  uuid, text, uuid, text, text, text, jsonb, text, uuid
) to authenticated, service_role;

-- Service-role audit writer for API-key task mutations (MCP / Bearer path).
create or replace function public.append_audit_event_for_api_key(
  p_org_id uuid,
  p_api_key_id uuid,
  p_action text,
  p_resource_type text,
  p_resource_id uuid,
  p_request_id uuid default null,
  p_after_data jsonb default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  key_ok boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.api_keys
    where api_keys.id = p_api_key_id
      and api_keys.org_id = p_org_id
      and api_keys.revoked_at is null
      and api_keys.deleted_at is null
  ) into key_ok;

  if not key_ok then
    raise exception 'API key not found'
      using errcode = 'P0002';
  end if;

  return private.append_audit_event(
    p_org_id,
    'api_key',
    p_api_key_id,
    p_action,
    p_resource_type,
    p_resource_id,
    p_request_id,
    null,
    null,
    null,
    p_after_data,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.append_audit_event_for_api_key(
  uuid, uuid, text, text, uuid, uuid, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.append_audit_event_for_api_key(
  uuid, uuid, text, text, uuid, uuid, jsonb, jsonb
) to service_role;

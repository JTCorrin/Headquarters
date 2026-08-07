-- Mentions-BE: timeline.mention notifications from payload.mentions on note create.
-- Extends user_notifications kinds/sources + optional payload for deep-links.

alter table public.user_notifications
  add column if not exists payload jsonb not null default '{}'::jsonb;

alter table public.user_notifications
  drop constraint if exists user_notifications_kind_check;

alter table public.user_notifications
  add constraint user_notifications_kind_check
  check (kind in ('email.received', 'timeline.mention'));

alter table public.user_notifications
  drop constraint if exists user_notifications_source_type_check;

alter table public.user_notifications
  add constraint user_notifications_source_type_check
  check (source_type in ('email_message', 'timeline_event'));

alter table public.user_notifications
  drop constraint if exists user_notifications_payload_object_check;

alter table public.user_notifications
  add constraint user_notifications_payload_object_check
  check (jsonb_typeof(payload) = 'object');

drop function if exists private.create_user_notification(
  uuid, uuid, text, text, uuid, text, text
);

create or replace function private.create_user_notification(
  p_org_id uuid,
  p_recipient_membership_id uuid,
  p_kind text,
  p_source_type text,
  p_source_id uuid,
  p_title text,
  p_body text default null,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_id uuid;
  title_text text := left(coalesce(nullif(btrim(p_title), ''), '(untitled)'), 200);
  body_text text := nullif(left(nullif(p_body, ''), 2000), '');
  payload_obj jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if jsonb_typeof(payload_obj) <> 'object' then
    payload_obj := '{}'::jsonb;
  end if;

  insert into public.user_notifications (
    org_id,
    recipient_membership_id,
    kind,
    title,
    body,
    source_type,
    source_id,
    payload
  )
  values (
    p_org_id,
    p_recipient_membership_id,
    p_kind,
    title_text,
    body_text,
    p_source_type,
    p_source_id,
    payload_obj
  )
  on conflict (org_id, recipient_membership_id, kind, source_id) do nothing
  returning id into created_id;

  if created_id is null then
    select user_notifications.id into created_id
    from public.user_notifications
    where user_notifications.org_id = p_org_id
      and user_notifications.recipient_membership_id = p_recipient_membership_id
      and user_notifications.kind = p_kind
      and user_notifications.source_id = p_source_id;
  end if;

  return created_id;
end;
$$;

revoke all on function private.create_user_notification(
  uuid, uuid, text, text, uuid, text, text, jsonb
) from public, anon, authenticated;

-- Compatibility for callers compiled against the pre-payload signature.
create or replace function private.create_user_notification(
  p_org_id uuid,
  p_recipient_membership_id uuid,
  p_kind text,
  p_source_type text,
  p_source_id uuid,
  p_title text,
  p_body text
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.create_user_notification(
    p_org_id,
    p_recipient_membership_id,
    p_kind,
    p_source_type,
    p_source_id,
    p_title,
    p_body,
    '{}'::jsonb
  );
$$;

revoke all on function private.create_user_notification(
  uuid, uuid, text, text, uuid, text, text
) from public, anon, authenticated;

create or replace function private.fanout_timeline_mentions(
  p_event public.timeline_events
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  author_membership_id uuid;
  mention jsonb;
  mention_membership_id uuid;
  seen uuid[] := array[]::uuid[];
  mention_count integer := 0;
  entity_label text;
  notif_title text;
  notif_body text;
  notif_payload jsonb;
begin
  -- JWT user path only (MCP/api_key fan-out deferred).
  if p_event.actor_type is distinct from 'user' or p_event.actor_id is null then
    return;
  end if;

  if p_event.payload is null
    or jsonb_typeof(p_event.payload) <> 'object'
    or not (p_event.payload ? 'mentions')
    or jsonb_typeof(p_event.payload -> 'mentions') <> 'array'
  then
    return;
  end if;

  select m.id into author_membership_id
  from public.memberships m
  where m.org_id = p_event.org_id
    and m.user_id = p_event.actor_id
    and m.status = 'active';

  entity_label := initcap(replace(p_event.entity_type, '_', ' '));
  notif_title := left('Mentioned you on a ' || entity_label, 200);
  notif_body := left(coalesce(nullif(btrim(p_event.title), ''), 'Timeline note'), 2000);
  notif_payload := jsonb_build_object(
    'entity_type', p_event.entity_type,
    'entity_id', p_event.entity_id,
    'timeline_event_id', p_event.id
  );

  for mention in
    select value
    from jsonb_array_elements(p_event.payload -> 'mentions')
  loop
    if mention_count >= 20 then
      exit;
    end if;

    if jsonb_typeof(mention) <> 'object' then
      continue;
    end if;

    if coalesce(mention ->> 'membership_id', '') !~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then
      continue;
    end if;

    mention_membership_id := (mention ->> 'membership_id')::uuid;

    if author_membership_id is not null
      and mention_membership_id = author_membership_id
    then
      continue;
    end if;

    if mention_membership_id = any (seen) then
      continue;
    end if;

    if not exists (
      select 1
      from public.memberships m
      where m.id = mention_membership_id
        and m.org_id = p_event.org_id
        and m.status = 'active'
        and m.role in ('owner', 'admin', 'member', 'readonly')
    ) then
      continue;
    end if;

    seen := array_append(seen, mention_membership_id);
    mention_count := mention_count + 1;

    perform private.create_user_notification(
      p_event.org_id,
      mention_membership_id,
      'timeline.mention',
      'timeline_event',
      p_event.id,
      notif_title,
      notif_body,
      notif_payload
    );
  end loop;
exception
  when others then
    -- Never block timeline note creation on mention fan-out errors.
    raise warning 'fanout_timeline_mentions failed: %', sqlerrm;
    return;
end;
$$;

revoke all on function private.fanout_timeline_mentions(public.timeline_events)
  from public, anon, authenticated;

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

  if p_payload ? 'mentions' then
    if jsonb_typeof(p_payload -> 'mentions') <> 'array' then
      raise exception 'Invalid mentions payload'
        using errcode = '22023';
    end if;
    if jsonb_array_length(p_payload -> 'mentions') > 20 then
      raise exception 'Too many mentions'
        using errcode = '22023';
    end if;
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

  perform private.fanout_timeline_mentions(created_row);

  return created_row;
end;
$$;

revoke all on function public.create_timeline_event(
  uuid, text, uuid, text, text, text, jsonb, text, uuid
) from public, anon;

grant execute on function public.create_timeline_event(
  uuid, text, uuid, text, text, text, jsonb, text, uuid
) to authenticated, service_role;

-- Include payload in list responses for bell deep-links.
create or replace function public.list_my_notifications(
  p_org_id uuid,
  p_limit integer default 50,
  p_cursor_created_at timestamptz default null,
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

  select coalesce(jsonb_agg(item order by created_at desc, id desc), '[]'::jsonb)
  into rows
  from (
    select
      jsonb_build_object(
        'id', n.id,
        'org_id', n.org_id,
        'kind', n.kind,
        'title', n.title,
        'body', n.body,
        'source_type', n.source_type,
        'source_id', n.source_id,
        'payload', n.payload,
        'read_at', n.read_at,
        'created_at', n.created_at
      ) as item,
      n.created_at,
      n.id
    from public.user_notifications n
    where n.org_id = p_org_id
      and n.recipient_membership_id = membership_row.id
      and (
        p_cursor_created_at is null
        or p_cursor_id is null
        or n.created_at < p_cursor_created_at
        or (n.created_at = p_cursor_created_at and n.id < p_cursor_id)
      )
    order by n.created_at desc, n.id desc
    limit lim
  ) page;

  return rows;
end;
$$;

create or replace function public.mark_notification_read(
  p_org_id uuid,
  p_notification_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  membership_row public.memberships;
  notification_row public.user_notifications;
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

  select * into notification_row
  from public.user_notifications
  where user_notifications.id = p_notification_id
    and user_notifications.org_id = p_org_id
    and user_notifications.recipient_membership_id = membership_row.id
  for update;

  if notification_row.id is null then
    raise exception 'Notification not found' using errcode = 'P0002';
  end if;

  if notification_row.read_at is null then
    update public.user_notifications
    set read_at = now()
    where user_notifications.id = notification_row.id
    returning * into notification_row;
  end if;

  return jsonb_build_object(
    'id', notification_row.id,
    'org_id', notification_row.org_id,
    'kind', notification_row.kind,
    'title', notification_row.title,
    'body', notification_row.body,
    'source_type', notification_row.source_type,
    'source_id', notification_row.source_id,
    'payload', notification_row.payload,
    'read_at', notification_row.read_at,
    'created_at', notification_row.created_at
  );
end;
$$;

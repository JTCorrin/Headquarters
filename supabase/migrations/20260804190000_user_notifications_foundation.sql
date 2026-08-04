-- Notifications v1: user_notifications + personal /me list/mark/count RPCs.
-- Writer hooks new-insert branch of upsert_inbound_email_message (email.received).
-- Distinct from timeline_events and audit_events.

create table public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  recipient_membership_id uuid not null,
  kind text not null,
  title text not null,
  body text,
  source_type text not null,
  source_id uuid not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint user_notifications_membership_fk
    foreign key (org_id, recipient_membership_id)
    references public.memberships (org_id, id)
    on delete cascade,
  constraint user_notifications_kind_check
    check (kind in ('email.received')),
  constraint user_notifications_source_type_check
    check (source_type in ('email_message')),
  constraint user_notifications_title_len
    check (char_length(title) between 1 and 200),
  constraint user_notifications_body_len
    check (body is null or char_length(body) <= 2000),
  constraint user_notifications_dedupe_uidx
    unique (org_id, recipient_membership_id, kind, source_id)
);

create index user_notifications_recipient_created_idx
  on public.user_notifications (
    org_id, recipient_membership_id, created_at desc, id desc
  );

create index user_notifications_recipient_unread_idx
  on public.user_notifications (org_id, recipient_membership_id)
  where read_at is null;

comment on table public.user_notifications is
  'Per-membership attention items (bell). Distinct from timeline_events and audit_events.';

alter table public.user_notifications enable row level security;

revoke all on table public.user_notifications from public, anon, authenticated;
grant select on table public.user_notifications to authenticated;

create policy user_notifications_select_own
on public.user_notifications
for select
to authenticated
using (
  recipient_membership_id = private.current_membership_id(org_id)
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
);

-- ---------------------------------------------------------------------------
-- Writer (service / other security definer only)
-- ---------------------------------------------------------------------------

create or replace function private.create_user_notification(
  p_org_id uuid,
  p_recipient_membership_id uuid,
  p_kind text,
  p_source_type text,
  p_source_id uuid,
  p_title text,
  p_body text default null
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
begin
  insert into public.user_notifications (
    org_id,
    recipient_membership_id,
    kind,
    title,
    body,
    source_type,
    source_id
  )
  values (
    p_org_id,
    p_recipient_membership_id,
    p_kind,
    title_text,
    body_text,
    p_source_type,
    p_source_id
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
  uuid, uuid, text, text, uuid, text, text
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Authenticated RPCs
-- ---------------------------------------------------------------------------

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

revoke all on function public.list_my_notifications(uuid, integer, timestamptz, uuid)
  from public, anon;
grant execute on function public.list_my_notifications(uuid, integer, timestamptz, uuid)
  to authenticated;

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
    'read_at', notification_row.read_at,
    'created_at', notification_row.created_at
  );
end;
$$;

revoke all on function public.mark_notification_read(uuid, uuid) from public, anon;
grant execute on function public.mark_notification_read(uuid, uuid) to authenticated;

create or replace function public.count_my_unread_notifications(p_org_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  membership_row public.memberships;
  unread_count integer;
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

  select count(*)::integer into unread_count
  from public.user_notifications n
  where n.org_id = p_org_id
    and n.recipient_membership_id = membership_row.id
    and n.read_at is null;

  return coalesce(unread_count, 0);
end;
$$;

revoke all on function public.count_my_unread_notifications(uuid) from public, anon;
grant execute on function public.count_my_unread_notifications(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Hook: new inbound email → email.received notification (mailbox owner only)
-- ---------------------------------------------------------------------------

create or replace function public.upsert_inbound_email_message(
  p_org_id uuid,
  p_mailbox_id uuid,
  p_provider_message_id text,
  p_provider_thread_id text,
  p_from_address text,
  p_from_name text,
  p_to_addresses jsonb,
  p_subject text,
  p_body_text text,
  p_preview_text text,
  p_received_at timestamptz,
  p_body_truncated boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  mailbox public.mailbox_accounts;
  thread_row public.email_threads;
  message_row public.email_messages;
  match_address extensions.citext;
  is_new boolean := false;
begin
  select * into mailbox
  from public.mailbox_accounts
  where mailbox_accounts.id = p_mailbox_id
    and mailbox_accounts.org_id = p_org_id
    and mailbox_accounts.deleted_at is null;

  if mailbox.id is null then
    raise exception 'Mailbox not found'
      using errcode = 'P0002';
  end if;

  if p_provider_thread_id is not null then
    select * into thread_row
    from public.email_threads
    where email_threads.mailbox_account_id = mailbox.id
      and email_threads.provider_thread_id = p_provider_thread_id
      and email_threads.deleted_at is null;

    if thread_row.id is null then
      insert into public.email_threads (
        org_id, mailbox_account_id, owner_membership_id,
        provider_thread_id, subject_normalized, last_message_at, message_count
      )
      values (
        p_org_id, mailbox.id, mailbox.membership_id,
        p_provider_thread_id, lower(coalesce(p_subject, '')),
        coalesce(p_received_at, now()), 0
      )
      returning * into thread_row;
    end if;
  end if;

  select * into message_row
  from public.email_messages
  where email_messages.mailbox_account_id = mailbox.id
    and email_messages.provider_message_id = p_provider_message_id
    and email_messages.deleted_at is null;

  if message_row.id is null then
    insert into public.email_messages (
      org_id, mailbox_account_id, owner_membership_id, thread_id,
      direction, status, provider, provider_message_id,
      from_address, from_name, to_addresses, subject,
      body_text, preview_text, body_truncated, received_at
    )
    values (
      p_org_id, mailbox.id, mailbox.membership_id, thread_row.id,
      'inbound', 'received', 'imap', p_provider_message_id,
      lower(trim(p_from_address)), nullif(trim(p_from_name), ''),
      coalesce(p_to_addresses, '[]'::jsonb), coalesce(p_subject, ''),
      p_body_text, p_preview_text, coalesce(p_body_truncated, false),
      coalesce(p_received_at, now())
    )
    returning * into message_row;
    is_new := true;
  else
    update public.email_messages
    set
      subject = coalesce(p_subject, email_messages.subject),
      body_text = coalesce(p_body_text, email_messages.body_text),
      preview_text = coalesce(p_preview_text, email_messages.preview_text),
      body_truncated = coalesce(p_body_truncated, email_messages.body_truncated),
      updated_at = now()
    where email_messages.id = message_row.id
    returning * into message_row;
  end if;

  if is_new then
    perform private.create_user_notification(
      p_org_id,
      mailbox.membership_id,
      'email.received',
      'email_message',
      message_row.id,
      coalesce(nullif(btrim(p_subject), ''), '(no subject)'),
      coalesce(p_preview_text, left(coalesce(p_body_text, ''), 200))
    );
  end if;

  if thread_row.id is not null then
    update public.email_threads
    set
      last_message_at = greatest(email_threads.last_message_at, coalesce(p_received_at, now())),
      message_count = (
        select count(*)::integer from public.email_messages
        where email_messages.thread_id = thread_row.id
          and email_messages.deleted_at is null
      ),
      updated_at = now()
    where email_threads.id = thread_row.id;
  end if;

  -- Exact-address match (from or to): contacts + clients on primary_email;
  -- leads via linked contact.primary_email (leads have no email column).
  for match_address in
    select distinct lower(addr) as addr
    from (
      select lower(trim(p_from_address)) as addr
      union all
      select lower(trim(x.email))
      from jsonb_array_elements(coalesce(p_to_addresses, '[]'::jsonb)) e
      cross join lateral (select e ->> 'email' as email) x
      where nullif(trim(x.email), '') is not null
    ) addrs
    where addr is not null and addr <> ''
  loop
    insert into public.email_message_links (
      org_id, message_id, entity_type, entity_id, link_reason
    )
    select p_org_id, message_row.id, 'contact', c.id, 'address_match'
    from public.contacts c
    where c.org_id = p_org_id
      and c.deleted_at is null
      and c.primary_email = match_address
    on conflict do nothing;

    insert into public.email_message_links (
      org_id, message_id, entity_type, entity_id, link_reason
    )
    select p_org_id, message_row.id, 'lead', l.id, 'address_match'
    from public.leads l
    join public.contacts c
      on c.org_id = l.org_id
     and c.id = l.contact_id
    where l.org_id = p_org_id
      and l.deleted_at is null
      and l.contact_id is not null
      and c.deleted_at is null
      and c.primary_email = match_address
    on conflict do nothing;

    insert into public.email_message_links (
      org_id, message_id, entity_type, entity_id, link_reason
    )
    select p_org_id, message_row.id, 'client', cl.id, 'address_match'
    from public.clients cl
    where cl.org_id = p_org_id
      and cl.deleted_at is null
      and cl.primary_email = match_address
    on conflict do nothing;
  end loop;

  return jsonb_build_object(
    'id', message_row.id,
    'thread_id', message_row.thread_id,
    'provider_message_id', message_row.provider_message_id,
    'owner_membership_id', message_row.owner_membership_id
  );
end;
$$;

revoke all on function public.upsert_inbound_email_message(
  uuid, uuid, text, text, text, text, jsonb, text, text, text, timestamptz, boolean
) from public, anon, authenticated;
grant execute on function public.upsert_inbound_email_message(
  uuid, uuid, text, text, text, text, jsonb, text, text, text, timestamptz, boolean
) to service_role;

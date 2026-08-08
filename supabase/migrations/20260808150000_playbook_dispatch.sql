-- Playbooks Phase E: generic start/dispatch RPCs, lint fix for lead email,
-- inbound email trigger hook (AFTER INSERT on email_messages).

set search_path = public, extensions, pg_catalog;

-- Fix: leads have no primary_email column (db lint / runtime).
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
    select contacts.primary_email into email
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

-- Generic run start (service_role / cron / dispatch). Busy-skip on active entity.
create or replace function public.start_playbook_run(
  p_org_id uuid,
  p_playbook_id uuid,
  p_trigger_kind text,
  p_root_entity_type text default null,
  p_root_entity_id uuid default null,
  p_trigger_payload jsonb default '{}'::jsonb,
  p_require_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pb public.playbooks;
  run_row public.playbook_runs;
  first_node text;
  graph jsonb;
  nodes jsonb;
  trigger_id text;
  trigger_kind text;
  n jsonb;
begin
  if auth.role() is distinct from 'service_role'
     and not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted' using errcode = '42501';
  end if;

  if auth.role() is distinct from 'service_role' and auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  if p_trigger_kind is null or btrim(p_trigger_kind) = '' then
    raise exception 'Invalid trigger kind' using errcode = '22023';
  end if;

  select * into pb
  from public.playbooks
  where playbooks.id = p_playbook_id
    and playbooks.org_id = p_org_id
    and playbooks.deleted_at is null
  for share;

  if not found then
    raise exception 'Playbook not found' using errcode = 'P0002';
  end if;

  if p_require_active and not pb.is_active then
    raise exception 'Playbook is not active' using errcode = 'P0001';
  end if;

  graph := pb.graph_json;
  nodes := graph->'nodes';

  trigger_id := null;
  trigger_kind := null;
  for n in select * from jsonb_array_elements(nodes)
  loop
    if n->>'type' = 'trigger' then
      if trigger_id is not null then
        raise exception 'Playbook must have exactly one trigger' using errcode = '22023';
      end if;
      trigger_id := n->>'id';
      trigger_kind := coalesce(n->'data'->>'kind', '');
    end if;
  end loop;

  if trigger_id is null then
    raise exception 'Playbook must have exactly one trigger' using errcode = '22023';
  end if;

  if trigger_kind is distinct from p_trigger_kind then
    raise exception 'Playbook trigger kind mismatch' using errcode = '22023';
  end if;

  select elem->>'target'
  into first_node
  from jsonb_array_elements(coalesce(graph->'edges', '[]'::jsonb)) as elem
  where elem->>'source' = trigger_id
  order by elem->>'target', elem->>'id'
  limit 1;

  if first_node is null then
    insert into public.playbook_runs (
      org_id, playbook_id, status, trigger_kind, trigger_payload,
      root_entity_type, root_entity_id, current_node_id, next_action_at,
      playbook_version, graph_snapshot
    ) values (
      p_org_id, p_playbook_id, 'completed', p_trigger_kind, coalesce(p_trigger_payload, '{}'::jsonb),
      p_root_entity_type, p_root_entity_id, null, null,
      pb.version, graph
    )
    returning * into run_row;
  else
    begin
      insert into public.playbook_runs (
        org_id, playbook_id, status, trigger_kind, trigger_payload,
        root_entity_type, root_entity_id, current_node_id, next_action_at,
        playbook_version, graph_snapshot
      ) values (
        p_org_id, p_playbook_id, 'scheduled', p_trigger_kind, coalesce(p_trigger_payload, '{}'::jsonb),
        p_root_entity_type, p_root_entity_id, first_node, now(),
        pb.version, graph
      )
      returning * into run_row;
    exception
      when unique_violation then
        insert into public.playbook_runs (
          org_id, playbook_id, status, trigger_kind, trigger_payload,
          root_entity_type, root_entity_id, current_node_id, next_action_at,
          playbook_version, graph_snapshot, last_error
        ) values (
          p_org_id, p_playbook_id, 'skipped_busy', p_trigger_kind, coalesce(p_trigger_payload, '{}'::jsonb),
          p_root_entity_type, p_root_entity_id, null, null,
          pb.version, graph, 'Active run already exists for this playbook and entity'
        )
        returning * into run_row;
    end;
  end if;

  return to_jsonb(run_row);
end;
$$;

revoke all on function public.start_playbook_run(uuid, uuid, text, text, uuid, jsonb, boolean)
  from public, anon;
grant execute on function public.start_playbook_run(uuid, uuid, text, text, uuid, jsonb, boolean)
  to authenticated, service_role;

-- Dispatch to all active playbooks whose trigger kind matches.
create or replace function public.dispatch_playbook_triggers(
  p_org_id uuid,
  p_trigger_kind text,
  p_root_entity_type text,
  p_root_entity_id uuid,
  p_trigger_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pb record;
  trigger_node jsonb;
  cfg jsonb;
  mailbox_filter text;
  min_amount bigint;
  run_json jsonb;
  started jsonb := '[]'::jsonb;
  skipped jsonb := '[]'::jsonb;
begin
  if auth.role() is distinct from 'service_role'
     and not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted' using errcode = '42501';
  end if;

  for pb in
    select playbooks.*
    from public.playbooks
    where playbooks.org_id = p_org_id
      and playbooks.deleted_at is null
      and playbooks.is_active = true
  loop
    select n
    into trigger_node
    from jsonb_array_elements(coalesce(pb.graph_json->'nodes', '[]'::jsonb)) as n
    where n->>'type' = 'trigger'
      and coalesce(n->'data'->>'kind', '') = p_trigger_kind
    limit 1;

    if trigger_node is null then
      continue;
    end if;

    cfg := coalesce(trigger_node->'data'->'config', '{}'::jsonb);

    if p_trigger_kind = 'email.received' then
      mailbox_filter := nullif(btrim(coalesce(cfg->>'mailboxId', cfg->>'mailbox_id', '')), '');
      if mailbox_filter is not null
         and mailbox_filter is distinct from coalesce(p_trigger_payload->>'mailbox_id', '') then
        continue;
      end if;
    end if;

    if p_trigger_kind = 'payment.received' then
      begin
        min_amount := nullif(cfg->>'min_amount_cents', '')::bigint;
      exception
        when others then
          min_amount := null;
      end;
      if min_amount is not null
         and coalesce((p_trigger_payload->>'amount_cents')::bigint, 0) < min_amount then
        continue;
      end if;
    end if;

    begin
      run_json := public.start_playbook_run(
        p_org_id,
        pb.id,
        p_trigger_kind,
        p_root_entity_type,
        p_root_entity_id,
        coalesce(p_trigger_payload, '{}'::jsonb),
        true
      );
      if run_json->>'status' = 'skipped_busy' then
        skipped := skipped || jsonb_build_array(run_json);
      else
        started := started || jsonb_build_array(run_json);
      end if;
    exception
      when others then
        skipped := skipped || jsonb_build_array(
          jsonb_build_object(
            'playbook_id', pb.id,
            'error', SQLERRM
          )
        );
    end;
  end loop;

  return jsonb_build_object('started', started, 'skipped', skipped);
end;
$$;

revoke all on function public.dispatch_playbook_triggers(uuid, text, text, uuid, jsonb)
  from public, anon;
grant execute on function public.dispatch_playbook_triggers(uuid, text, text, uuid, jsonb)
  to authenticated, service_role;

-- Fire email.received playbooks on new inbound rows (IMAP upsert inserts only when new).
create or replace function private.email_message_playbook_dispatch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction = 'inbound' then
    perform public.dispatch_playbook_triggers(
      new.org_id,
      'email.received',
      'email_message',
      new.id,
      jsonb_build_object(
        'mailbox_id', new.mailbox_account_id,
        'message_id', new.id,
        'from_address', new.from_address,
        'subject', coalesce(new.subject, '')
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists email_messages_playbook_dispatch on public.email_messages;
create trigger email_messages_playbook_dispatch
after insert on public.email_messages
for each row
execute function private.email_message_playbook_dispatch();

-- List client contact ids for loopRelated (service_role).
create or replace function public.list_playbook_client_contact_ids(
  p_org_id uuid,
  p_client_id uuid
)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ids uuid[];
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select coalesce(array_agg(cc.contact_id order by cc.is_primary desc, cc.contact_id), '{}')
  into ids
  from public.client_contacts cc
  where cc.org_id = p_org_id
    and cc.client_id = p_client_id
    and cc.deleted_at is null;

  return ids;
end;
$$;

revoke all on function public.list_playbook_client_contact_ids(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.list_playbook_client_contact_ids(uuid, uuid)
  to service_role;

-- Stabilize primary-link locking: discover→lock→revalidate via savepoint
-- retries; bump exactly the contacts demoted under those locks. Callers must
-- not pre-lock the subject before the helper (deadlock with cross-swaps).

drop function if exists private.set_contact_primary_client(uuid, uuid, uuid, uuid);

create function private.set_contact_primary_client(
  p_org_id uuid,
  p_contact_id uuid,
  p_client_id uuid,
  p_actor_id uuid,
  p_expected_version integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  prior_primary_client_id uuid;
  target_link_id uuid;
  discovered_ids uuid[];
  revalidated_ids uuid[];
  displaced_ids uuid[] := '{}';
  lock_id uuid;
  rows_touched integer;
  subject_changed boolean := false;
  subject_ok boolean;
  subject_version integer;
  attempt integer := 0;
begin
  if p_client_id is null then
    perform contacts.id
    from public.contacts
    where contacts.id = p_contact_id
      and contacts.org_id = p_org_id
      and contacts.deleted_at is null
    for update;

    if not found then
      raise exception 'Contact must be an active contact in the same organisation'
        using errcode = '22023';
    end if;

    if p_expected_version is not null then
      select contacts.version into subject_version
      from public.contacts
      where contacts.id = p_contact_id;

      if subject_version is distinct from p_expected_version then
        raise exception 'Contact version conflict'
          using errcode = 'P0001';
      end if;
    end if;

    select client_contacts.client_id
    into prior_primary_client_id
    from public.client_contacts
    where client_contacts.org_id = p_org_id
      and client_contacts.contact_id = p_contact_id
      and client_contacts.is_primary
      and client_contacts.deleted_at is null
    limit 1;

    update public.client_contacts
    set
      is_primary = false,
      role = case when role = 'primary' then 'other' else role end,
      updated_by = p_actor_id
    where client_contacts.org_id = p_org_id
      and client_contacts.contact_id = p_contact_id
      and client_contacts.is_primary
      and client_contacts.deleted_at is null;

    if prior_primary_client_id is not null then
      update public.contacts
      set updated_by = p_actor_id
      where contacts.id = p_contact_id;
    end if;

    return null;
  end if;

  perform clients.id
  from public.clients
  where clients.id = p_client_id
    and clients.org_id = p_org_id
    and clients.deleted_at is null;

  if not found then
    raise exception 'Contact client must be an active client in the same organisation'
      using errcode = '22023';
  end if;

  -- Discover the lock set, take sorted row locks, revalidate; retry on drift.
  <<stabilize_locks>>
  loop
    attempt := attempt + 1;
    if attempt > 32 then
      raise exception 'Could not stabilize contact primary locks'
        using errcode = '40001';
    end if;

    savepoint contact_primary_locks;

    select coalesce(
      array_agg(lock_candidate order by lock_candidate),
      array[p_contact_id]::uuid[]
    )
    into discovered_ids
    from (
      select p_contact_id as lock_candidate
      union
      select client_contacts.contact_id
      from public.client_contacts
      where client_contacts.org_id = p_org_id
        and client_contacts.client_id = p_client_id
        and client_contacts.contact_id is distinct from p_contact_id
        and client_contacts.is_primary
        and client_contacts.deleted_at is null
    ) candidates;

    subject_ok := false;
    foreach lock_id in array discovered_ids
    loop
      perform contacts.id
      from public.contacts
      where contacts.id = lock_id
        and contacts.org_id = p_org_id
        and contacts.deleted_at is null
      for update;

      if lock_id = p_contact_id then
        subject_ok := found;
      end if;
    end loop;

    if not subject_ok then
      raise exception 'Contact must be an active contact in the same organisation'
        using errcode = '22023';
    end if;

    select coalesce(
      array_agg(lock_candidate order by lock_candidate),
      array[p_contact_id]::uuid[]
    )
    into revalidated_ids
    from (
      select p_contact_id as lock_candidate
      union
      select client_contacts.contact_id
      from public.client_contacts
      where client_contacts.org_id = p_org_id
        and client_contacts.client_id = p_client_id
        and client_contacts.contact_id is distinct from p_contact_id
        and client_contacts.is_primary
        and client_contacts.deleted_at is null
    ) candidates;

    if revalidated_ids = discovered_ids then
      release savepoint contact_primary_locks;
      exit stabilize_locks;
    end if;

    -- Lock set drifted; drop row locks and rediscover.
    rollback to savepoint contact_primary_locks;
  end loop;

  if p_expected_version is not null then
    select contacts.version into subject_version
    from public.contacts
    where contacts.id = p_contact_id;

    if subject_version is distinct from p_expected_version then
      raise exception 'Contact version conflict'
        using errcode = 'P0001';
    end if;
  end if;

  select client_contacts.client_id
  into prior_primary_client_id
  from public.client_contacts
  where client_contacts.org_id = p_org_id
    and client_contacts.contact_id = p_contact_id
    and client_contacts.is_primary
    and client_contacts.deleted_at is null
  limit 1;

  update public.client_contacts
  set
    is_primary = false,
    role = case when role = 'primary' then 'other' else role end,
    updated_by = p_actor_id
  where client_contacts.org_id = p_org_id
    and client_contacts.contact_id = p_contact_id
    and client_contacts.client_id is distinct from p_client_id
    and client_contacts.is_primary
    and client_contacts.deleted_at is null;
  get diagnostics rows_touched = row_count;
  if rows_touched > 0 then
    subject_changed := true;
  end if;

  -- Demote whoever is actually primary now; bump exactly those contacts.
  with demoted as (
    update public.client_contacts
    set
      is_primary = false,
      role = case when role = 'primary' then 'other' else role end,
      updated_by = p_actor_id
    where client_contacts.org_id = p_org_id
      and client_contacts.client_id = p_client_id
      and client_contacts.contact_id is distinct from p_contact_id
      and client_contacts.is_primary
      and client_contacts.deleted_at is null
    returning client_contacts.contact_id
  )
  select coalesce(array_agg(distinct demoted.contact_id), '{}'::uuid[])
  into displaced_ids
  from demoted;

  select client_contacts.id
  into target_link_id
  from public.client_contacts
  where client_contacts.org_id = p_org_id
    and client_contacts.client_id = p_client_id
    and client_contacts.contact_id = p_contact_id
    and client_contacts.deleted_at is null
  limit 1;

  if target_link_id is not null then
    update public.client_contacts
    set
      is_primary = true,
      role = 'primary',
      updated_by = p_actor_id
    where client_contacts.id = target_link_id
      and (
        client_contacts.is_primary is distinct from true
        or client_contacts.role is distinct from 'primary'
      );
    get diagnostics rows_touched = row_count;
    if rows_touched > 0 then
      subject_changed := true;
    end if;
  else
    subject_changed := true;

    select client_contacts.id
    into target_link_id
    from public.client_contacts
    where client_contacts.org_id = p_org_id
      and client_contacts.client_id = p_client_id
      and client_contacts.contact_id = p_contact_id
      and client_contacts.deleted_at is not null
    order by client_contacts.created_at desc
    limit 1;

    if target_link_id is not null then
      update public.client_contacts
      set
        deleted_at = null,
        is_primary = true,
        role = 'primary',
        updated_by = p_actor_id
      where client_contacts.id = target_link_id;
    else
      insert into public.client_contacts (
        org_id,
        client_id,
        contact_id,
        role,
        is_primary,
        created_by,
        updated_by
      )
      values (
        p_org_id,
        p_client_id,
        p_contact_id,
        'primary',
        true,
        p_actor_id,
        p_actor_id
      );
    end if;
  end if;

  if prior_primary_client_id is distinct from p_client_id then
    subject_changed := true;
  end if;

  if subject_changed then
    update public.contacts
    set updated_by = p_actor_id
    where contacts.id = p_contact_id;
  end if;

  foreach lock_id in array displaced_ids
  loop
    update public.contacts
    set updated_by = p_actor_id
    where contacts.id = lock_id
      and contacts.deleted_at is null;
  end loop;

  return p_client_id;
end;
$$;

revoke all on function private.set_contact_primary_client(uuid, uuid, uuid, uuid, integer)
  from public, anon, authenticated;

create or replace function public.create_contact_with_primary_client(
  p_org_id uuid,
  p_payload jsonb,
  p_client_id uuid default null,
  p_set_client_id boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  contact_row public.contacts;
  resolved_client_id uuid := null;
  display_name text;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Contact payload must be an object'
      using errcode = '22023';
  end if;

  if p_set_client_id and p_client_id is not null then
    perform clients.id
    from public.clients
    where clients.id = p_client_id
      and clients.org_id = p_org_id
      and clients.deleted_at is null;

    if not found then
      raise exception 'Contact client must be an active client in the same organisation'
        using errcode = '22023';
    end if;
  end if;

  display_name := nullif(trim(coalesce(p_payload ->> 'display_name', '')), '');
  if display_name is null or char_length(display_name) > 200 then
    raise exception 'Contact display_name must be between 1 and 200 characters'
      using errcode = '22023';
  end if;

  insert into public.contacts (
    org_id,
    first_name,
    last_name,
    display_name,
    primary_email,
    primary_phone,
    job_title,
    company_name,
    owner_membership_id,
    lifecycle_status,
    source,
    notes,
    metadata,
    created_by,
    updated_by
  )
  values (
    p_org_id,
    nullif(trim(coalesce(p_payload ->> 'first_name', '')), ''),
    nullif(trim(coalesce(p_payload ->> 'last_name', '')), ''),
    display_name,
    nullif(trim(coalesce(p_payload ->> 'primary_email', '')), ''),
    nullif(trim(coalesce(p_payload ->> 'primary_phone', '')), ''),
    nullif(trim(coalesce(p_payload ->> 'job_title', '')), ''),
    nullif(trim(coalesce(p_payload ->> 'company_name', '')), ''),
    nullif(p_payload ->> 'owner_membership_id', '')::uuid,
    coalesce(nullif(trim(p_payload ->> 'lifecycle_status'), ''), 'active'),
    nullif(trim(coalesce(p_payload ->> 'source', '')), ''),
    nullif(trim(coalesce(p_payload ->> 'notes', '')), ''),
    coalesce(p_payload -> 'metadata', '{}'::jsonb),
    actor_id,
    actor_id
  )
  returning * into contact_row;

  if p_set_client_id then
    resolved_client_id := private.set_contact_primary_client(
      p_org_id,
      contact_row.id,
      p_client_id,
      actor_id,
      null
    );

    select * into contact_row
    from public.contacts
    where contacts.id = contact_row.id;
  end if;

  return jsonb_build_object(
    'contact', to_jsonb(contact_row),
    'client_id', to_jsonb(resolved_client_id)
  );
end;
$$;

create or replace function public.update_contact_with_primary_client(
  p_contact_id uuid,
  p_org_id uuid,
  p_expected_version integer,
  p_payload jsonb default '{}'::jsonb,
  p_client_id uuid default null,
  p_set_client_id boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  contact_row public.contacts;
  resolved_client_id uuid := null;
  payload jsonb := coalesce(p_payload, '{}'::jsonb);
  has_row_fields boolean;
  version_before_link integer;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  if jsonb_typeof(payload) <> 'object' then
    raise exception 'Contact payload must be an object'
      using errcode = '22023';
  end if;

  has_row_fields := payload ?| array[
    'first_name',
    'last_name',
    'display_name',
    'primary_email',
    'primary_phone',
    'job_title',
    'company_name',
    'owner_membership_id',
    'lifecycle_status',
    'source',
    'notes',
    'metadata'
  ];

  if not has_row_fields and not p_set_client_id then
    raise exception 'At least one writable field is required'
      using errcode = '22023';
  end if;

  if p_set_client_id and p_client_id is not null then
    perform clients.id
    from public.clients
    where clients.id = p_client_id
      and clients.org_id = p_org_id
      and clients.deleted_at is null;

    if not found then
      raise exception 'Contact client must be an active client in the same organisation'
        using errcode = '22023';
    end if;
  end if;

  if p_set_client_id then
    -- Do not pre-lock the subject: the helper acquires a globally ordered
    -- multi-contact lock set (subject + current target primary).
    perform contacts.id
    from public.contacts
    where contacts.id = p_contact_id
      and contacts.org_id = p_org_id
      and contacts.deleted_at is null;

    if not found then
      raise exception 'Contact not found'
        using errcode = 'P0002';
    end if;

    version_before_link := p_expected_version;

    resolved_client_id := private.set_contact_primary_client(
      p_org_id,
      p_contact_id,
      p_client_id,
      actor_id,
      p_expected_version
    );

    select * into contact_row
    from public.contacts
    where contacts.id = p_contact_id;

    if has_row_fields then
      update public.contacts
      set
        first_name = case
          when payload ? 'first_name' then nullif(trim(coalesce(payload ->> 'first_name', '')), '')
          else contacts.first_name
        end,
        last_name = case
          when payload ? 'last_name' then nullif(trim(coalesce(payload ->> 'last_name', '')), '')
          else contacts.last_name
        end,
        display_name = case
          when payload ? 'display_name' then nullif(trim(coalesce(payload ->> 'display_name', '')), '')
          else contacts.display_name
        end,
        primary_email = case
          when payload ? 'primary_email' then nullif(trim(coalesce(payload ->> 'primary_email', '')), '')
          else contacts.primary_email
        end,
        primary_phone = case
          when payload ? 'primary_phone' then nullif(trim(coalesce(payload ->> 'primary_phone', '')), '')
          else contacts.primary_phone
        end,
        job_title = case
          when payload ? 'job_title' then nullif(trim(coalesce(payload ->> 'job_title', '')), '')
          else contacts.job_title
        end,
        company_name = case
          when payload ? 'company_name' then nullif(trim(coalesce(payload ->> 'company_name', '')), '')
          else contacts.company_name
        end,
        owner_membership_id = case
          when payload ? 'owner_membership_id' then nullif(payload ->> 'owner_membership_id', '')::uuid
          else contacts.owner_membership_id
        end,
        lifecycle_status = case
          when payload ? 'lifecycle_status' then nullif(trim(payload ->> 'lifecycle_status'), '')
          else contacts.lifecycle_status
        end,
        source = case
          when payload ? 'source' then nullif(trim(coalesce(payload ->> 'source', '')), '')
          else contacts.source
        end,
        notes = case
          when payload ? 'notes' then nullif(trim(coalesce(payload ->> 'notes', '')), '')
          else contacts.notes
        end,
        metadata = case
          when payload ? 'metadata' then coalesce(payload -> 'metadata', '{}'::jsonb)
          else contacts.metadata
        end,
        updated_by = actor_id
      where contacts.id = contact_row.id
      returning * into contact_row;
    elsif contact_row.version = version_before_link then
      update public.contacts
      set updated_by = actor_id
      where contacts.id = contact_row.id
      returning * into contact_row;
    end if;
  else
    select * into contact_row
    from public.contacts
    where contacts.id = p_contact_id
      and contacts.org_id = p_org_id
      and contacts.deleted_at is null
    for update;

    if not found then
      raise exception 'Contact not found'
        using errcode = 'P0002';
    end if;

    if contact_row.version is distinct from p_expected_version then
      raise exception 'Contact version conflict'
        using errcode = 'P0001';
    end if;

    update public.contacts
    set
      first_name = case
        when payload ? 'first_name' then nullif(trim(coalesce(payload ->> 'first_name', '')), '')
        else contacts.first_name
      end,
      last_name = case
        when payload ? 'last_name' then nullif(trim(coalesce(payload ->> 'last_name', '')), '')
        else contacts.last_name
      end,
      display_name = case
        when payload ? 'display_name' then nullif(trim(coalesce(payload ->> 'display_name', '')), '')
        else contacts.display_name
      end,
      primary_email = case
        when payload ? 'primary_email' then nullif(trim(coalesce(payload ->> 'primary_email', '')), '')
        else contacts.primary_email
      end,
      primary_phone = case
        when payload ? 'primary_phone' then nullif(trim(coalesce(payload ->> 'primary_phone', '')), '')
        else contacts.primary_phone
      end,
      job_title = case
        when payload ? 'job_title' then nullif(trim(coalesce(payload ->> 'job_title', '')), '')
        else contacts.job_title
      end,
      company_name = case
        when payload ? 'company_name' then nullif(trim(coalesce(payload ->> 'company_name', '')), '')
        else contacts.company_name
      end,
      owner_membership_id = case
        when payload ? 'owner_membership_id' then nullif(payload ->> 'owner_membership_id', '')::uuid
        else contacts.owner_membership_id
      end,
      lifecycle_status = case
        when payload ? 'lifecycle_status' then nullif(trim(payload ->> 'lifecycle_status'), '')
        else contacts.lifecycle_status
      end,
      source = case
        when payload ? 'source' then nullif(trim(coalesce(payload ->> 'source', '')), '')
        else contacts.source
      end,
      notes = case
        when payload ? 'notes' then nullif(trim(coalesce(payload ->> 'notes', '')), '')
        else contacts.notes
      end,
      metadata = case
        when payload ? 'metadata' then coalesce(payload -> 'metadata', '{}'::jsonb)
        else contacts.metadata
      end,
      updated_by = actor_id
    where contacts.id = contact_row.id
    returning * into contact_row;

    select client_contacts.client_id
    into resolved_client_id
    from public.client_contacts
    where client_contacts.org_id = p_org_id
      and client_contacts.contact_id = contact_row.id
      and client_contacts.is_primary
      and client_contacts.deleted_at is null
    limit 1;
  end if;

  return jsonb_build_object(
    'contact', to_jsonb(contact_row),
    'client_id', to_jsonb(resolved_client_id)
  );
end;
$$;

revoke all on function public.create_contact_with_primary_client(uuid, jsonb, uuid, boolean)
  from public, anon;
grant execute on function public.create_contact_with_primary_client(uuid, jsonb, uuid, boolean)
  to authenticated;

revoke all on function public.update_contact_with_primary_client(uuid, uuid, integer, jsonb, uuid, boolean)
  from public, anon;
grant execute on function public.update_contact_with_primary_client(uuid, uuid, integer, jsonb, uuid, boolean)
  to authenticated;

create or replace function public.convert_lead(
  p_lead_id uuid,
  p_client_name text default null,
  p_client_status text default 'active'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  lead_row public.leads;
  client_row public.clients;
  contact_row public.contacts;
  client_name text;
  client_status text := coalesce(nullif(trim(p_client_status), ''), 'active');
  contact_email text;
  contact_phone text;
  now_ts timestamptz := now();
  reused_client boolean := false;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if client_status not in ('prospect', 'active', 'on_hold', 'inactive', 'archived') then
    raise exception 'Client status is invalid'
      using errcode = '22023';
  end if;

  select * into lead_row
  from public.leads
  where leads.id = p_lead_id
    and leads.deleted_at is null
  for update;

  if not found then
    raise exception 'Lead not found'
      using errcode = 'P0002';
  end if;

  if not private.has_org_role(
    lead_row.org_id,
    array['owner', 'admin', 'member']
  ) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  if lead_row.stage = 'won' then
    if lead_row.client_id is null
      or lead_row.won_at is null
      or lead_row.converted_at is null
    then
      raise exception 'Converted lead is in an inconsistent state'
        using errcode = '23514';
    end if;

    select * into client_row
    from public.clients
    where clients.id = lead_row.client_id
      and clients.org_id = lead_row.org_id
    for update;

    if not found then
      raise exception 'Converted lead is missing its client'
        using errcode = 'P0002';
    end if;

    if client_row.deleted_at is not null then
      update public.clients
      set
        deleted_at = null,
        updated_by = actor_id
      where clients.id = client_row.id
      returning * into client_row;
    end if;

    if lead_row.contact_id is not null then
      -- Validate without pre-locking; helper owns the ordered contact lock set.
      select * into contact_row
      from public.contacts
      where contacts.id = lead_row.contact_id
        and contacts.org_id = lead_row.org_id;

      if not found or contact_row.deleted_at is not null then
        raise exception 'Lead contact must be an active contact in the same organisation'
          using errcode = '22023';
      end if;

      perform private.set_contact_primary_client(
        lead_row.org_id,
        lead_row.contact_id,
        client_row.id,
        actor_id,
        null
      );
    end if;

    return jsonb_build_object(
      'lead', to_jsonb(lead_row),
      'client', to_jsonb(client_row),
      'idempotent', true
    );
  end if;

  if lead_row.stage = 'lost' then
    raise exception 'Lost leads cannot be converted'
      using errcode = '22023';
  end if;

  contact_email := null;
  contact_phone := null;
  if lead_row.contact_id is not null then
    select * into contact_row
    from public.contacts
    where contacts.id = lead_row.contact_id
      and contacts.org_id = lead_row.org_id;

    if not found or contact_row.deleted_at is not null then
      raise exception 'Lead contact must be an active contact in the same organisation'
        using errcode = '22023';
    end if;

    contact_email := contact_row.primary_email;
    contact_phone := contact_row.primary_phone;
  end if;

  if lead_row.client_id is not null then
    reused_client := true;

    select * into client_row
    from public.clients
    where clients.id = lead_row.client_id
      and clients.org_id = lead_row.org_id
    for update;

    if not found or client_row.deleted_at is not null then
      raise exception 'Lead client must be an active client in the same organisation'
        using errcode = '22023';
    end if;

    if client_row.converted_from_lead_id is null then
      update public.clients
      set
        converted_from_lead_id = lead_row.id,
        updated_by = actor_id
      where clients.id = client_row.id
      returning * into client_row;
    end if;
  else
    client_name := coalesce(
      nullif(trim(p_client_name), ''),
      nullif(trim(lead_row.company_name), ''),
      lead_row.name
    );

    insert into public.clients (
      org_id,
      name,
      status,
      primary_email,
      phone,
      default_currency,
      owner_membership_id,
      converted_from_lead_id,
      notes,
      metadata,
      created_by,
      updated_by
    )
    values (
      lead_row.org_id,
      client_name,
      client_status,
      contact_email,
      contact_phone,
      lead_row.currency,
      lead_row.owner_membership_id,
      lead_row.id,
      lead_row.notes,
      coalesce(lead_row.metadata, '{}'::jsonb),
      actor_id,
      actor_id
    )
    returning * into client_row;
  end if;

  if lead_row.contact_id is not null then
    perform private.set_contact_primary_client(
      lead_row.org_id,
      lead_row.contact_id,
      client_row.id,
      actor_id,
      null
    );
  end if;

  update public.leads
  set
    stage = 'won',
    client_id = client_row.id,
    won_at = now_ts,
    converted_at = now_ts,
    lost_at = null,
    lost_reason = null,
    updated_by = actor_id
  where leads.id = lead_row.id
  returning * into lead_row;

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
  )
  values
    (
      lead_row.org_id,
      'lead',
      lead_row.id,
      'conversion',
      'Lead converted to client',
      case
        when reused_client then format('Linked existing client "%s"', client_row.name)
        else format('Created client "%s"', client_row.name)
      end,
      'user',
      actor_id,
      'client',
      client_row.id,
      jsonb_build_object(
        'client_id', client_row.id,
        'lead_id', lead_row.id,
        'reused_client', reused_client
      ),
      now_ts
    ),
    (
      lead_row.org_id,
      'client',
      client_row.id,
      'conversion',
      'Client created from conversion',
      'Converted from the sales pipeline',
      'user',
      actor_id,
      null,
      null,
      jsonb_build_object('client_id', client_row.id, 'reused_client', reused_client),
      now_ts
    );

  return jsonb_build_object(
    'lead', to_jsonb(lead_row),
    'client', to_jsonb(client_row),
    'idempotent', false
  );
end;
$$;

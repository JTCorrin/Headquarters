-- Atomic contact create/update + primary client_contacts link.
-- Preserves unrelated secondary client_contacts rows (many-to-many).
-- Virtual client_id only changes which link is primary for this contact.

create or replace function private.set_contact_primary_client(
  p_org_id uuid,
  p_contact_id uuid,
  p_client_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_link_id uuid;
begin
  -- Clear primary designation for this contact on every client; keep secondary links.
  if p_client_id is null then
    update public.client_contacts
    set
      is_primary = false,
      role = case when role = 'primary' then 'other' else role end,
      updated_by = p_actor_id
    where client_contacts.org_id = p_org_id
      and client_contacts.contact_id = p_contact_id
      and client_contacts.is_primary
      and client_contacts.deleted_at is null;

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

  -- This contact may be primary on at most one client (form selection).
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

  -- One primary contact per client.
  update public.client_contacts
  set
    is_primary = false,
    role = case when role = 'primary' then 'other' else role end,
    updated_by = p_actor_id
  where client_contacts.org_id = p_org_id
    and client_contacts.client_id = p_client_id
    and client_contacts.contact_id is distinct from p_contact_id
    and client_contacts.is_primary
    and client_contacts.deleted_at is null;

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
    where client_contacts.id = target_link_id;

    return p_client_id;
  end if;

  -- Restore a soft-deleted link if present; otherwise insert.
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

  return p_client_id;
end;
$$;

revoke all on function private.set_contact_primary_client(uuid, uuid, uuid, uuid)
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

  -- Validate client before insert so a bad client_id cannot orphan a contact.
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
      actor_id
    );
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

  -- Validate client before mutating contact so a bad client_id rolls back cleanly.
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
  elsif p_set_client_id then
    -- Link-only PATCH still advances version so If-Match serializes link changes.
    update public.contacts
    set updated_by = actor_id
    where contacts.id = contact_row.id
    returning * into contact_row;
  end if;

  if p_set_client_id then
    resolved_client_id := private.set_contact_primary_client(
      p_org_id,
      contact_row.id,
      p_client_id,
      actor_id
    );
  else
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

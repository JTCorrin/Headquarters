-- MCP Wave A hotfix: contact create/update under API-key / service_role.
-- Edge already role-gates; grant EXECUTE to service_role and accept p_actor_id
-- (API key creator user id) when auth.uid() is null. JWT path unchanged.

drop function if exists public.create_contact_with_primary_client(uuid, jsonb, uuid, boolean);
drop function if exists public.update_contact_with_primary_client(uuid, uuid, integer, jsonb, uuid, boolean);

create or replace function public.create_contact_with_primary_client(
  p_org_id uuid,
  p_payload jsonb,
  p_client_id uuid default null,
  p_set_client_id boolean default false,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  jwt_uid uuid := auth.uid();
  actor_id uuid;
  contact_row public.contacts;
  resolved_client_id uuid := null;
  display_name text;
begin
  if jwt_uid is not null then
    actor_id := jwt_uid;
    if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
  elsif auth.role() = 'service_role' then
    if p_actor_id is null then
      raise exception 'Authentication is required'
        using errcode = '42501';
    end if;
    if not exists (
      select 1
      from public.memberships
      join public.organisations
        on organisations.id = memberships.org_id
      where memberships.org_id = p_org_id
        and memberships.user_id = p_actor_id
        and memberships.status = 'active'
        and organisations.deleted_at is null
        and memberships.role = any (array['owner', 'admin', 'member'])
    ) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
    actor_id := p_actor_id;
  else
    raise exception 'Authentication is required'
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
  p_set_client_id boolean default false,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  jwt_uid uuid := auth.uid();
  actor_id uuid;
  contact_row public.contacts;
  resolved_client_id uuid := null;
  payload jsonb := coalesce(p_payload, '{}'::jsonb);
  has_row_fields boolean;
  version_before_link integer;
begin
  if jwt_uid is not null then
    actor_id := jwt_uid;
    if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
  elsif auth.role() = 'service_role' then
    if p_actor_id is null then
      raise exception 'Authentication is required'
        using errcode = '42501';
    end if;
    if not exists (
      select 1
      from public.memberships
      join public.organisations
        on organisations.id = memberships.org_id
      where memberships.org_id = p_org_id
        and memberships.user_id = p_actor_id
        and memberships.status = 'active'
        and organisations.deleted_at is null
        and memberships.role = any (array['owner', 'admin', 'member'])
    ) then
      raise exception 'This action is not permitted'
        using errcode = '42501';
    end if;
    actor_id := p_actor_id;
  else
    raise exception 'Authentication is required'
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

revoke all on function public.create_contact_with_primary_client(uuid, jsonb, uuid, boolean, uuid)
  from public, anon;
grant execute on function public.create_contact_with_primary_client(uuid, jsonb, uuid, boolean, uuid)
  to authenticated, service_role;

revoke all on function public.update_contact_with_primary_client(uuid, uuid, integer, jsonb, uuid, boolean, uuid)
  from public, anon;
grant execute on function public.update_contact_with_primary_client(uuid, uuid, integer, jsonb, uuid, boolean, uuid)
  to authenticated, service_role;

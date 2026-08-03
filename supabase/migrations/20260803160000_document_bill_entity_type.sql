-- Allow document folders/links to target bills (source attachment workspace).

alter table public.document_folders
  drop constraint document_folders_entity_type_check;

alter table public.document_folders
  add constraint document_folders_entity_type_check
  check (
    entity_type in (
      'client',
      'contact',
      'lead',
      'organisation',
      'meeting',
      'bill'
    )
  );

alter table public.document_links
  drop constraint document_links_entity_type_check;

alter table public.document_links
  add constraint document_links_entity_type_check
  check (
    entity_type in (
      'client',
      'contact',
      'lead',
      'organisation',
      'meeting',
      'bill'
    )
  );

create or replace function private.assert_document_entity_type(p_entity_type text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_entity_type is null
    or p_entity_type not in (
      'client',
      'contact',
      'lead',
      'organisation',
      'meeting',
      'bill'
    )
  then
    raise exception 'Document entity_type is invalid'
      using errcode = '22023';
  end if;
  return p_entity_type;
end;
$$;

create or replace function private.assert_document_entity_exists(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_document_entity_type(p_entity_type);

  if p_entity_id is null then
    raise exception 'Document entity_id is required'
      using errcode = '22023';
  end if;

  if p_entity_type = 'client' then
    if not exists (
      select 1
      from public.clients
      where clients.id = p_entity_id
        and clients.org_id = p_org_id
        and clients.deleted_at is null
    ) then
      raise exception 'Document client must be an active client in the same organisation'
        using errcode = '22023';
    end if;
  elsif p_entity_type = 'contact' then
    if not exists (
      select 1
      from public.contacts
      where contacts.id = p_entity_id
        and contacts.org_id = p_org_id
        and contacts.deleted_at is null
    ) then
      raise exception 'Document contact must be an active contact in the same organisation'
        using errcode = '22023';
    end if;
  elsif p_entity_type = 'lead' then
    if not exists (
      select 1
      from public.leads
      where leads.id = p_entity_id
        and leads.org_id = p_org_id
        and leads.deleted_at is null
    ) then
      raise exception 'Document lead must be an active lead in the same organisation'
        using errcode = '22023';
    end if;
  elsif p_entity_type = 'organisation' then
    if p_entity_id is distinct from p_org_id
      or not exists (
        select 1
        from public.organisations
        where organisations.id = p_org_id
          and organisations.deleted_at is null
      )
    then
      raise exception 'Document organisation entity must match the active organisation'
        using errcode = '22023';
    end if;
  elsif p_entity_type = 'meeting' then
    -- meetings table is not provisioned yet; type is reserved/extendable.
    null;
  elsif p_entity_type = 'bill' then
    if not exists (
      select 1
      from public.bills
      where bills.id = p_entity_id
        and bills.org_id = p_org_id
        and bills.deleted_at is null
    ) then
      raise exception 'Document bill must be an active bill in the same organisation'
        using errcode = '22023';
    end if;
  end if;
end;
$$;

revoke all on function private.assert_document_entity_type(text)
  from public, anon, authenticated;
revoke all on function private.assert_document_entity_exists(uuid, text, uuid)
  from public, anon, authenticated;

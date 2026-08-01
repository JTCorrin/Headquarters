-- Document storage foundation: folders, documents metadata, entity links,
-- private org-documents bucket, and security-definer browse/upload RPCs.
-- Edge Functions / signed-URL issuance intentionally deferred (service-role).

set search_path = public, extensions, pg_catalog;

-- ---------------------------------------------------------------------------
-- document_folders
-- ---------------------------------------------------------------------------

create table public.document_folders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  entity_type text not null,
  entity_id uuid not null,
  parent_id uuid,
  name text not null check (char_length(name) between 1 and 160),
  constraint document_folders_org_id_id_key unique (org_id, id),
  constraint document_folders_entity_type_check
    check (
      entity_type in (
        'client',
        'contact',
        'lead',
        'organisation',
        'meeting'
      )
    ),
  constraint document_folders_parent_fk
    foreign key (org_id, parent_id)
    references public.document_folders (org_id, id)
    on delete restrict
);

create unique index document_folders_sibling_name_uidx
  on public.document_folders (
    org_id,
    entity_type,
    entity_id,
    parent_id,
    name
  )
  nulls not distinct
  where deleted_at is null;

create index document_folders_entity_idx
  on public.document_folders (
    org_id,
    entity_type,
    entity_id,
    parent_id,
    name
  )
  where deleted_at is null;

create trigger document_folders_stamp_business_row
before insert or update on public.document_folders
for each row execute function private.stamp_business_row();

-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  name text not null check (char_length(name) between 1 and 160),
  category text not null,
  notes text,
  bucket text not null default 'org-documents',
  storage_path text not null,
  storage_version text,
  mime_type text not null check (char_length(mime_type) between 1 and 255),
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  uploaded_by uuid references public.profiles (id) on delete set null,
  uploaded_at timestamptz,
  scan_status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'pending_upload',
  upload_expires_at timestamptz,
  constraint documents_org_id_id_key unique (org_id, id),
  constraint documents_bucket_storage_path_key unique (bucket, storage_path),
  constraint documents_category_check
    check (
      category in (
        'contract',
        'proposal',
        'invoice',
        'receipt',
        'transcript',
        'recording',
        'other'
      )
    ),
  constraint documents_scan_status_check
    check (scan_status in ('pending', 'clean', 'infected', 'failed')),
  constraint documents_status_check
    check (status in ('pending_upload', 'ready', 'orphan', 'failed')),
  constraint documents_metadata_object_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint documents_bucket_check
    check (bucket = 'org-documents'),
  constraint documents_ready_uploaded_at_check
    check (status <> 'ready' or uploaded_at is not null),
  constraint documents_notes_length_check
    check (notes is null or char_length(notes) <= 2000)
);

create index documents_org_status_idx
  on public.documents (org_id, status, created_at desc)
  where deleted_at is null;

create index documents_org_upload_expires_idx
  on public.documents (upload_expires_at)
  where deleted_at is null and status = 'pending_upload';

create trigger documents_stamp_business_row
before insert or update on public.documents
for each row execute function private.stamp_business_row();

-- ---------------------------------------------------------------------------
-- document_links
-- ---------------------------------------------------------------------------

create table public.document_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  version integer not null default 1 check (version > 0),
  document_id uuid not null,
  entity_type text not null,
  entity_id uuid not null,
  folder_id uuid,
  constraint document_links_org_id_id_key unique (org_id, id),
  constraint document_links_document_fk
    foreign key (org_id, document_id)
    references public.documents (org_id, id)
    on delete cascade,
  constraint document_links_folder_fk
    foreign key (org_id, folder_id)
    references public.document_folders (org_id, id)
    on delete set null (folder_id),
  constraint document_links_entity_type_check
    check (
      entity_type in (
        'client',
        'contact',
        'lead',
        'organisation',
        'meeting'
      )
    )
);

create unique index document_links_document_entity_uidx
  on public.document_links (document_id, entity_type, entity_id)
  where deleted_at is null;

create index document_links_entity_folder_idx
  on public.document_links (
    org_id,
    entity_type,
    entity_id,
    folder_id,
    created_at desc
  )
  where deleted_at is null;

create index document_links_document_idx
  on public.document_links (org_id, document_id)
  where deleted_at is null;

create trigger document_links_stamp_business_row
before insert or update on public.document_links
for each row execute function private.stamp_business_row();

-- ---------------------------------------------------------------------------
-- Storage bucket (private; signed URLs via service role)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('org-documents', 'org-documents', false, 52428800)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

-- No permissive authenticated policies on storage.objects for org-documents.
-- Service role bypasses RLS for signed URL / object IO (default-deny otherwise).
-- Restrictive guard: if a future permissive policy is added, still block
-- cross-tenant paths that do not start with org/{org_id}/ for a membership.
drop policy if exists org_documents_tenant_path_select on storage.objects;
drop policy if exists org_documents_tenant_path_insert on storage.objects;
drop policy if exists org_documents_tenant_path_update on storage.objects;
drop policy if exists org_documents_tenant_path_delete on storage.objects;

create policy org_documents_tenant_path_select
on storage.objects
as restrictive
for select
to authenticated
using (
  bucket_id is distinct from 'org-documents'
  or (
    (regexp_match(
      name,
      '^org/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})/'
    ))[1] is not null
    and private.has_org_role(
      (regexp_match(
        name,
        '^org/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})/'
      ))[1]::uuid,
      array['owner', 'admin', 'member', 'readonly']
    )
  )
);

create policy org_documents_tenant_path_insert
on storage.objects
as restrictive
for insert
to authenticated
with check (
  bucket_id is distinct from 'org-documents'
  or (
    (regexp_match(
      name,
      '^org/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})/'
    ))[1] is not null
    and private.has_org_role(
      (regexp_match(
        name,
        '^org/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})/'
      ))[1]::uuid,
      array['owner', 'admin', 'member']
    )
  )
);

create policy org_documents_tenant_path_update
on storage.objects
as restrictive
for update
to authenticated
using (
  bucket_id is distinct from 'org-documents'
  or (
    (regexp_match(
      name,
      '^org/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})/'
    ))[1] is not null
    and private.has_org_role(
      (regexp_match(
        name,
        '^org/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})/'
      ))[1]::uuid,
      array['owner', 'admin', 'member']
    )
  )
)
with check (
  bucket_id is distinct from 'org-documents'
  or (
    (regexp_match(
      name,
      '^org/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})/'
    ))[1] is not null
    and private.has_org_role(
      (regexp_match(
        name,
        '^org/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})/'
      ))[1]::uuid,
      array['owner', 'admin', 'member']
    )
  )
);

create policy org_documents_tenant_path_delete
on storage.objects
as restrictive
for delete
to authenticated
using (
  bucket_id is distinct from 'org-documents'
  or (
    (regexp_match(
      name,
      '^org/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})/'
    ))[1] is not null
    and private.has_org_role(
      (regexp_match(
        name,
        '^org/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})/'
      ))[1]::uuid,
      array['owner', 'admin', 'member']
    )
  )
);

-- ---------------------------------------------------------------------------
-- Private helpers
-- ---------------------------------------------------------------------------

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
      'meeting'
    )
  then
    raise exception 'Document entity_type is invalid'
      using errcode = '22023';
  end if;
  return p_entity_type;
end;
$$;

revoke all on function private.assert_document_entity_type(text)
  from public, anon, authenticated;

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
    -- Self-link: entity_id must be the organisation row for p_org_id.
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
  end if;
end;
$$;

revoke all on function private.assert_document_entity_exists(uuid, text, uuid)
  from public, anon, authenticated;

create or replace function private.assert_document_folder_placement(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_folder_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  folder_row public.document_folders;
begin
  if p_folder_id is null then
    return;
  end if;

  select * into folder_row
  from public.document_folders
  where document_folders.id = p_folder_id
    and document_folders.org_id = p_org_id
    and document_folders.deleted_at is null;

  if not found then
    raise exception 'Document folder not found'
      using errcode = 'P0002';
  end if;

  if folder_row.entity_type is distinct from p_entity_type
    or folder_row.entity_id is distinct from p_entity_id
  then
    raise exception 'Document folder must belong to the same entity'
      using errcode = '22023';
  end if;
end;
$$;

revoke all on function private.assert_document_folder_placement(uuid, text, uuid, uuid)
  from public, anon, authenticated;

create or replace function private.document_folder_would_cycle(
  p_org_id uuid,
  p_folder_id uuid,
  p_new_parent_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_new_parent_id is not null
    and (
      p_new_parent_id = p_folder_id
      or exists (
        with recursive descendants as (
          select document_folders.id
          from public.document_folders
          where document_folders.org_id = p_org_id
            and document_folders.parent_id = p_folder_id
            and document_folders.deleted_at is null
          union all
          select child.id
          from public.document_folders as child
          join descendants on descendants.id = child.parent_id
          where child.org_id = p_org_id
            and child.deleted_at is null
        )
        select 1
        from descendants
        where descendants.id = p_new_parent_id
      )
    );
$$;

revoke all on function private.document_folder_would_cycle(uuid, uuid, uuid)
  from public, anon, authenticated;

create or replace function private.mark_expired_pending_document(
  p_document_id uuid,
  p_org_id uuid default null
)
returns public.documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  doc_row public.documents;
begin
  select * into doc_row
  from public.documents
  where documents.id = p_document_id
    and (p_org_id is null or documents.org_id = p_org_id)
    and documents.deleted_at is null
  for update;

  if not found then
    return null;
  end if;

  if doc_row.status is distinct from 'pending_upload' then
    return doc_row;
  end if;

  if doc_row.upload_expires_at is null or doc_row.upload_expires_at > now() then
    return doc_row;
  end if;

  update public.documents
  set
    status = 'orphan',
    updated_by = coalesce(auth.uid(), documents.updated_by)
  where documents.id = doc_row.id
  returning * into doc_row;

  return doc_row;
end;
$$;

revoke all on function private.mark_expired_pending_document(uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Folder RPCs
-- ---------------------------------------------------------------------------

create or replace function public.create_document_folder(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_name text,
  p_parent_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  folder_name text;
  folder_row public.document_folders;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  perform private.assert_document_entity_exists(p_org_id, p_entity_type, p_entity_id);
  perform private.assert_document_folder_placement(
    p_org_id,
    p_entity_type,
    p_entity_id,
    p_parent_id
  );

  folder_name := nullif(trim(coalesce(p_name, '')), '');
  if folder_name is null or char_length(folder_name) > 160 then
    raise exception 'Folder name must be between 1 and 160 characters'
      using errcode = '22023';
  end if;

  begin
    insert into public.document_folders (
      org_id,
      entity_type,
      entity_id,
      parent_id,
      name,
      created_by,
      updated_by
    )
    values (
      p_org_id,
      p_entity_type,
      p_entity_id,
      p_parent_id,
      folder_name,
      actor_id,
      actor_id
    )
    returning * into folder_row;
  exception
    when unique_violation then
      raise exception 'A folder with this name already exists under the same parent'
        using errcode = '23505';
  end;

  return jsonb_build_object('folder', to_jsonb(folder_row));
end;
$$;

create or replace function public.rename_document_folder(
  p_org_id uuid,
  p_folder_id uuid,
  p_expected_version integer,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  folder_name text;
  folder_row public.document_folders;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  folder_name := nullif(trim(coalesce(p_name, '')), '');
  if folder_name is null or char_length(folder_name) > 160 then
    raise exception 'Folder name must be between 1 and 160 characters'
      using errcode = '22023';
  end if;

  select * into folder_row
  from public.document_folders
  where document_folders.id = p_folder_id
    and document_folders.org_id = p_org_id
    and document_folders.deleted_at is null
  for update;

  if not found then
    raise exception 'Document folder not found'
      using errcode = 'P0002';
  end if;

  if folder_row.version is distinct from p_expected_version then
    raise exception 'Document folder version conflict'
      using errcode = 'P0001';
  end if;

  begin
    update public.document_folders
    set
      name = folder_name,
      updated_by = actor_id
    where document_folders.id = folder_row.id
    returning * into folder_row;
  exception
    when unique_violation then
      raise exception 'A folder with this name already exists under the same parent'
        using errcode = '23505';
  end;

  return jsonb_build_object('folder', to_jsonb(folder_row));
end;
$$;

create or replace function public.move_document_folder(
  p_org_id uuid,
  p_folder_id uuid,
  p_expected_version integer,
  p_parent_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  folder_row public.document_folders;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into folder_row
  from public.document_folders
  where document_folders.id = p_folder_id
    and document_folders.org_id = p_org_id
    and document_folders.deleted_at is null
  for update;

  if not found then
    raise exception 'Document folder not found'
      using errcode = 'P0002';
  end if;

  if folder_row.version is distinct from p_expected_version then
    raise exception 'Document folder version conflict'
      using errcode = 'P0001';
  end if;

  perform private.assert_document_folder_placement(
    p_org_id,
    folder_row.entity_type,
    folder_row.entity_id,
    p_parent_id
  );

  if private.document_folder_would_cycle(p_org_id, p_folder_id, p_parent_id) then
    raise exception 'Document folder move would create a cycle'
      using errcode = '22023';
  end if;

  begin
    update public.document_folders
    set
      parent_id = p_parent_id,
      updated_by = actor_id
    where document_folders.id = folder_row.id
    returning * into folder_row;
  exception
    when unique_violation then
      raise exception 'A folder with this name already exists under the same parent'
        using errcode = '23505';
  end;

  return jsonb_build_object('folder', to_jsonb(folder_row));
end;
$$;

create or replace function public.soft_delete_document_folder(
  p_org_id uuid,
  p_folder_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  folder_row public.document_folders;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into folder_row
  from public.document_folders
  where document_folders.id = p_folder_id
    and document_folders.org_id = p_org_id
    and document_folders.deleted_at is null
  for update;

  if not found then
    raise exception 'Document folder not found'
      using errcode = 'P0002';
  end if;

  if folder_row.version is distinct from p_expected_version then
    raise exception 'Document folder version conflict'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.document_folders as child
    where child.org_id = p_org_id
      and child.parent_id = folder_row.id
      and child.deleted_at is null
  ) then
    raise exception 'Document folder still contains subfolders'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.document_links
    join public.documents
      on documents.id = document_links.document_id
     and documents.org_id = document_links.org_id
    where document_links.org_id = p_org_id
      and document_links.folder_id = folder_row.id
      and document_links.deleted_at is null
      and documents.deleted_at is null
  ) then
    raise exception 'Document folder still contains documents'
      using errcode = '23514';
  end if;

  update public.document_folders
  set
    deleted_at = now(),
    updated_by = actor_id
  where document_folders.id = folder_row.id
  returning * into folder_row;

  return jsonb_build_object('folder', to_jsonb(folder_row));
end;
$$;

create or replace function public.restore_document_folder(
  p_org_id uuid,
  p_folder_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  folder_row public.document_folders;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into folder_row
  from public.document_folders
  where document_folders.id = p_folder_id
    and document_folders.org_id = p_org_id
    and document_folders.deleted_at is not null
  for update;

  if not found then
    raise exception 'Document folder not found'
      using errcode = 'P0002';
  end if;

  if folder_row.version is distinct from p_expected_version then
    raise exception 'Document folder version conflict'
      using errcode = 'P0001';
  end if;

  if folder_row.parent_id is not null
    and not exists (
      select 1
      from public.document_folders as parent
      where parent.id = folder_row.parent_id
        and parent.org_id = p_org_id
        and parent.deleted_at is null
        and parent.entity_type = folder_row.entity_type
        and parent.entity_id = folder_row.entity_id
    )
  then
    raise exception 'Document folder parent must be restored first'
      using errcode = '22023';
  end if;

  begin
    update public.document_folders
    set
      deleted_at = null,
      updated_by = actor_id
    where document_folders.id = folder_row.id
    returning * into folder_row;
  exception
    when unique_violation then
      raise exception 'A folder with this name already exists under the same parent'
        using errcode = '23505';
  end;

  return jsonb_build_object('folder', to_jsonb(folder_row));
end;
$$;

-- ---------------------------------------------------------------------------
-- Browse + upload lifecycle RPCs
-- ---------------------------------------------------------------------------

create or replace function public.browse_entity_documents(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_folder_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  folders_json jsonb;
  documents_json jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(
    p_org_id,
    array['owner', 'admin', 'member', 'readonly']
  ) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  perform private.assert_document_entity_type(p_entity_type);

  if p_entity_id is null then
    raise exception 'Document entity_id is required'
      using errcode = '22023';
  end if;

  if p_folder_id is not null then
    perform private.assert_document_folder_placement(
      p_org_id,
      p_entity_type,
      p_entity_id,
      p_folder_id
    );
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(document_folders) order by document_folders.name, document_folders.id),
    '[]'::jsonb
  )
  into folders_json
  from public.document_folders
  where document_folders.org_id = p_org_id
    and document_folders.entity_type = p_entity_type
    and document_folders.entity_id = p_entity_id
    and document_folders.deleted_at is null
    and document_folders.parent_id is not distinct from p_folder_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'document', to_jsonb(documents),
        'link', to_jsonb(document_links)
      )
      order by documents.name, documents.id
    ),
    '[]'::jsonb
  )
  into documents_json
  from public.document_links
  join public.documents
    on documents.id = document_links.document_id
   and documents.org_id = document_links.org_id
  where document_links.org_id = p_org_id
    and document_links.entity_type = p_entity_type
    and document_links.entity_id = p_entity_id
    and document_links.deleted_at is null
    and document_links.folder_id is not distinct from p_folder_id
    and documents.deleted_at is null
    and documents.status in ('ready', 'pending_upload');

  return jsonb_build_object(
    'folders', folders_json,
    'documents', documents_json
  );
end;
$$;

create or replace function public.create_document_upload_intent(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_folder_id uuid,
  p_name text,
  p_category text,
  p_mime_type text,
  p_size_bytes bigint,
  p_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  doc_id uuid := gen_random_uuid();
  object_id uuid := gen_random_uuid();
  doc_name text;
  mime text;
  digest text;
  storage_key text;
  doc_row public.documents;
  link_row public.document_links;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  perform private.assert_document_entity_exists(p_org_id, p_entity_type, p_entity_id);
  perform private.assert_document_folder_placement(
    p_org_id,
    p_entity_type,
    p_entity_id,
    p_folder_id
  );

  doc_name := nullif(trim(coalesce(p_name, '')), '');
  if doc_name is null or char_length(doc_name) > 160 then
    raise exception 'Document name must be between 1 and 160 characters'
      using errcode = '22023';
  end if;

  if p_category is null
    or p_category not in (
      'contract',
      'proposal',
      'invoice',
      'receipt',
      'transcript',
      'recording',
      'other'
    )
  then
    raise exception 'Document category is invalid'
      using errcode = '22023';
  end if;

  mime := nullif(trim(coalesce(p_mime_type, '')), '');
  if mime is null or char_length(mime) > 255 then
    raise exception 'Document mime_type is invalid'
      using errcode = '22023';
  end if;

  if p_size_bytes is null or p_size_bytes < 0 then
    raise exception 'Document size_bytes must be a non-negative integer'
      using errcode = '22023';
  end if;

  if p_size_bytes > 52428800 then
    raise exception 'Document exceeds the maximum upload size'
      using errcode = '22023';
  end if;

  digest := lower(nullif(trim(coalesce(p_sha256, '')), ''));
  if digest is null or digest !~ '^[a-f0-9]{64}$' then
    raise exception 'Document sha256 must be a 64-character hex digest'
      using errcode = '22023';
  end if;

  -- Server-owned object key; clients must not supply storage_path.
  storage_key :=
    'org/'
    || p_org_id::text
    || '/documents/'
    || doc_id::text
    || '/'
    || object_id::text;

  insert into public.documents (
    id,
    org_id,
    name,
    category,
    bucket,
    storage_path,
    mime_type,
    size_bytes,
    sha256,
    uploaded_by,
    scan_status,
    metadata,
    status,
    upload_expires_at,
    created_by,
    updated_by
  )
  values (
    doc_id,
    p_org_id,
    doc_name,
    p_category,
    'org-documents',
    storage_key,
    mime,
    p_size_bytes,
    digest,
    actor_id,
    'pending',
    '{}'::jsonb,
    'pending_upload',
    now() + interval '1 hour',
    actor_id,
    actor_id
  )
  returning * into doc_row;

  insert into public.document_links (
    org_id,
    document_id,
    entity_type,
    entity_id,
    folder_id,
    created_by,
    updated_by
  )
  values (
    p_org_id,
    doc_row.id,
    p_entity_type,
    p_entity_id,
    p_folder_id,
    actor_id,
    actor_id
  )
  returning * into link_row;

  return jsonb_build_object(
    'document', to_jsonb(doc_row),
    'link', to_jsonb(link_row)
  );
end;
$$;

create or replace function public.finalize_document_upload(
  p_org_id uuid,
  p_document_id uuid,
  p_expected_size_bytes bigint default null,
  p_expected_sha256 text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  doc_row public.documents;
  object_row storage.objects;
  object_size bigint;
  object_mime text;
  object_etag text;
  expected_digest text;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into doc_row
  from public.documents
  where documents.id = p_document_id
    and documents.org_id = p_org_id
    and documents.deleted_at is null
  for update;

  if not found then
    raise exception 'Document not found'
      using errcode = 'P0002';
  end if;

  if doc_row.status = 'ready' then
    return jsonb_build_object('document', to_jsonb(doc_row));
  end if;

  if doc_row.status not in ('pending_upload', 'orphan', 'failed') then
    raise exception 'Document cannot be finalized from status %', doc_row.status
      using errcode = '22023';
  end if;

  -- Expire pending uploads before accepting the object.
  if doc_row.status = 'pending_upload' then
    doc_row := private.mark_expired_pending_document(doc_row.id, p_org_id);
    if doc_row is null then
      raise exception 'Document not found'
        using errcode = 'P0002';
    end if;

    if doc_row.status = 'orphan' then
      return jsonb_build_object('document', to_jsonb(doc_row));
    end if;
  end if;

  select * into object_row
  from storage.objects
  where objects.bucket_id = doc_row.bucket
    and objects.name = doc_row.storage_path;

  if not found then
    update public.documents
    set
      status = case
        when doc_row.upload_expires_at is not null
          and doc_row.upload_expires_at <= now()
        then 'orphan'
        else 'failed'
      end,
      updated_by = actor_id
    where documents.id = doc_row.id
    returning * into doc_row;

    return jsonb_build_object('document', to_jsonb(doc_row));
  end if;

  object_size := coalesce(
    nullif(object_row.metadata ->> 'size', '')::bigint,
    nullif(object_row.metadata ->> 'contentLength', '')::bigint
  );
  object_mime := nullif(trim(coalesce(object_row.metadata ->> 'mimetype', '')), '');
  object_etag := coalesce(
    nullif(trim(coalesce(object_row.metadata ->> 'eTag', '')), ''),
    nullif(trim(coalesce(object_row.version, '')), '')
  );

  expected_digest := lower(nullif(trim(coalesce(p_expected_sha256, '')), ''));
  if expected_digest is not null and expected_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'Document sha256 must be a 64-character hex digest'
      using errcode = '22023';
  end if;

  if p_expected_size_bytes is not null
    and p_expected_size_bytes is distinct from doc_row.size_bytes
  then
    update public.documents
    set
      status = 'failed',
      updated_by = actor_id
    where documents.id = doc_row.id
    returning * into doc_row;

    return jsonb_build_object('document', to_jsonb(doc_row));
  end if;

  if object_size is not null and object_size is distinct from doc_row.size_bytes then
    update public.documents
    set
      status = 'failed',
      updated_by = actor_id
    where documents.id = doc_row.id
    returning * into doc_row;

    return jsonb_build_object('document', to_jsonb(doc_row));
  end if;

  if expected_digest is not null and expected_digest is distinct from doc_row.sha256 then
    update public.documents
    set
      status = 'failed',
      updated_by = actor_id
    where documents.id = doc_row.id
    returning * into doc_row;

    return jsonb_build_object('document', to_jsonb(doc_row));
  end if;

  update public.documents
  set
    status = 'ready',
    uploaded_at = coalesce(object_row.created_at, now()),
    uploaded_by = coalesce(documents.uploaded_by, actor_id),
    storage_version = object_etag,
    mime_type = coalesce(object_mime, documents.mime_type),
    size_bytes = coalesce(object_size, documents.size_bytes),
    upload_expires_at = null,
    updated_by = actor_id
  where documents.id = doc_row.id
  returning * into doc_row;

  return jsonb_build_object('document', to_jsonb(doc_row));
end;
$$;

create or replace function public.reap_expired_document_uploads()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  reaped integer := 0;
begin
  -- Callable by authenticated members of any org that owns expired rows,
  -- or by trusted jobs (auth.uid() null) for maintenance.
  if actor_id is not null
    and not exists (
      select 1
      from public.memberships
      where memberships.user_id = actor_id
        and memberships.status = 'active'
        and memberships.role in ('owner', 'admin', 'member')
    )
  then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  update public.documents
  set
    status = 'orphan',
    updated_by = coalesce(actor_id, documents.updated_by)
  where documents.deleted_at is null
    and documents.status = 'pending_upload'
    and documents.upload_expires_at is not null
    and documents.upload_expires_at <= now()
    and (
      actor_id is null
      or private.has_org_role(
        documents.org_id,
        array['owner', 'admin', 'member']
      )
    );

  get diagnostics reaped = row_count;
  return reaped;
end;
$$;

create or replace function public.soft_delete_document(
  p_org_id uuid,
  p_document_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  doc_row public.documents;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into doc_row
  from public.documents
  where documents.id = p_document_id
    and documents.org_id = p_org_id
    and documents.deleted_at is null
  for update;

  if not found then
    raise exception 'Document not found'
      using errcode = 'P0002';
  end if;

  if doc_row.version is distinct from p_expected_version then
    raise exception 'Document version conflict'
      using errcode = 'P0001';
  end if;

  update public.documents
  set
    deleted_at = now(),
    updated_by = actor_id
  where documents.id = doc_row.id
  returning * into doc_row;

  update public.document_links
  set
    deleted_at = coalesce(document_links.deleted_at, now()),
    updated_by = actor_id
  where document_links.document_id = doc_row.id
    and document_links.org_id = p_org_id
    and document_links.deleted_at is null;

  return jsonb_build_object('document', to_jsonb(doc_row));
end;
$$;

create or replace function public.restore_document(
  p_org_id uuid,
  p_document_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  doc_row public.documents;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into doc_row
  from public.documents
  where documents.id = p_document_id
    and documents.org_id = p_org_id
    and documents.deleted_at is not null
  for update;

  if not found then
    raise exception 'Document not found'
      using errcode = 'P0002';
  end if;

  if doc_row.version is distinct from p_expected_version then
    raise exception 'Document version conflict'
      using errcode = 'P0001';
  end if;

  update public.documents
  set
    deleted_at = null,
    updated_by = actor_id
  where documents.id = doc_row.id
  returning * into doc_row;

  update public.document_links
  set
    deleted_at = null,
    updated_by = actor_id
  where document_links.document_id = doc_row.id
    and document_links.org_id = p_org_id
    and document_links.deleted_at is not null;

  return jsonb_build_object('document', to_jsonb(doc_row));
end;
$$;

create or replace function public.rename_document(
  p_org_id uuid,
  p_document_id uuid,
  p_expected_version integer,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  doc_name text;
  doc_row public.documents;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  doc_name := nullif(trim(coalesce(p_name, '')), '');
  if doc_name is null or char_length(doc_name) > 160 then
    raise exception 'Document name must be between 1 and 160 characters'
      using errcode = '22023';
  end if;

  select * into doc_row
  from public.documents
  where documents.id = p_document_id
    and documents.org_id = p_org_id
    and documents.deleted_at is null
  for update;

  if not found then
    raise exception 'Document not found'
      using errcode = 'P0002';
  end if;

  if doc_row.version is distinct from p_expected_version then
    raise exception 'Document version conflict'
      using errcode = 'P0001';
  end if;

  update public.documents
  set
    name = doc_name,
    updated_by = actor_id
  where documents.id = doc_row.id
  returning * into doc_row;

  return jsonb_build_object('document', to_jsonb(doc_row));
end;
$$;

create or replace function public.move_document_link(
  p_org_id uuid,
  p_document_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_expected_version integer,
  p_folder_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  link_row public.document_links;
  doc_row public.documents;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  perform private.assert_document_entity_type(p_entity_type);

  select * into doc_row
  from public.documents
  where documents.id = p_document_id
    and documents.org_id = p_org_id
    and documents.deleted_at is null
  for share;

  if not found then
    raise exception 'Document not found'
      using errcode = 'P0002';
  end if;

  select * into link_row
  from public.document_links
  where document_links.org_id = p_org_id
    and document_links.document_id = p_document_id
    and document_links.entity_type = p_entity_type
    and document_links.entity_id = p_entity_id
    and document_links.deleted_at is null
  for update;

  if not found then
    raise exception 'Document link not found'
      using errcode = 'P0002';
  end if;

  if link_row.version is distinct from p_expected_version then
    raise exception 'Document link version conflict'
      using errcode = 'P0001';
  end if;

  perform private.assert_document_folder_placement(
    p_org_id,
    link_row.entity_type,
    link_row.entity_id,
    p_folder_id
  );

  update public.document_links
  set
    folder_id = p_folder_id,
    updated_by = actor_id
  where document_links.id = link_row.id
  returning * into link_row;

  return jsonb_build_object(
    'document', to_jsonb(doc_row),
    'link', to_jsonb(link_row)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.create_document_folder(uuid, text, uuid, text, uuid)
  from public, anon;
revoke all on function public.rename_document_folder(uuid, uuid, integer, text)
  from public, anon;
revoke all on function public.move_document_folder(uuid, uuid, integer, uuid)
  from public, anon;
revoke all on function public.soft_delete_document_folder(uuid, uuid, integer)
  from public, anon;
revoke all on function public.restore_document_folder(uuid, uuid, integer)
  from public, anon;
revoke all on function public.browse_entity_documents(uuid, text, uuid, uuid)
  from public, anon;
revoke all on function public.create_document_upload_intent(
  uuid, text, uuid, uuid, text, text, text, bigint, text
) from public, anon;
revoke all on function public.finalize_document_upload(uuid, uuid, bigint, text)
  from public, anon;
revoke all on function public.reap_expired_document_uploads()
  from public, anon;
revoke all on function public.soft_delete_document(uuid, uuid, integer)
  from public, anon;
revoke all on function public.restore_document(uuid, uuid, integer)
  from public, anon;
revoke all on function public.rename_document(uuid, uuid, integer, text)
  from public, anon;
revoke all on function public.move_document_link(
  uuid, uuid, text, uuid, integer, uuid
) from public, anon;

grant execute on function public.create_document_folder(uuid, text, uuid, text, uuid)
  to authenticated;
grant execute on function public.rename_document_folder(uuid, uuid, integer, text)
  to authenticated;
grant execute on function public.move_document_folder(uuid, uuid, integer, uuid)
  to authenticated;
grant execute on function public.soft_delete_document_folder(uuid, uuid, integer)
  to authenticated;
grant execute on function public.restore_document_folder(uuid, uuid, integer)
  to authenticated;
grant execute on function public.browse_entity_documents(uuid, text, uuid, uuid)
  to authenticated;
grant execute on function public.create_document_upload_intent(
  uuid, text, uuid, uuid, text, text, text, bigint, text
) to authenticated;
grant execute on function public.finalize_document_upload(uuid, uuid, bigint, text)
  to authenticated;
grant execute on function public.reap_expired_document_uploads()
  to authenticated;
grant execute on function public.soft_delete_document(uuid, uuid, integer)
  to authenticated;
grant execute on function public.restore_document(uuid, uuid, integer)
  to authenticated;
grant execute on function public.rename_document(uuid, uuid, integer, text)
  to authenticated;
grant execute on function public.move_document_link(
  uuid, uuid, text, uuid, integer, uuid
) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS + table grants (select for members; mutations via RPCs)
-- ---------------------------------------------------------------------------

alter table public.document_folders enable row level security;
alter table public.documents enable row level security;
alter table public.document_links enable row level security;

create policy document_folders_select_member
on public.document_folders
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
);

create policy documents_select_member
on public.documents
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
);

create policy document_links_select_member
on public.document_links
for select
to authenticated
using (
  deleted_at is null
  and private.has_org_role(
    org_id,
    array['owner', 'admin', 'member', 'readonly']
  )
  and exists (
    select 1
    from public.documents
    where documents.id = document_links.document_id
      and documents.org_id = document_links.org_id
      and documents.deleted_at is null
  )
);

revoke all on table public.document_folders from public, anon, authenticated;
revoke all on table public.documents from public, anon, authenticated;
revoke all on table public.document_links from public, anon, authenticated;

grant select on table public.document_folders to authenticated;
grant select on table public.documents to authenticated;
grant select on table public.document_links to authenticated;

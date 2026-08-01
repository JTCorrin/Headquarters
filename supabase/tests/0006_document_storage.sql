begin;

select plan(57);

select has_table('public', 'documents', 'documents table exists');
select has_table('public', 'document_folders', 'document_folders table exists');
select has_table('public', 'document_links', 'document_links table exists');

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.documents'::regclass
  ),
  'documents have row level security enabled'
);

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.document_folders'::regclass
  ),
  'document_folders have row level security enabled'
);

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.document_links'::regclass
  ),
  'document_links have row level security enabled'
);

select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'documents'
      and policyname = 'documents_select_member'
  ),
  'documents select policy exists'
);

select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'document_folders'
      and policyname = 'document_folders_select_member'
  ),
  'document_folders select policy exists'
);

select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'document_links'
      and policyname = 'document_links_select_member'
  ),
  'document_links select policy exists'
);

select ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'documents'
      and grantee = 'authenticated'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ),
  'authenticated users cannot mutate documents directly'
);

select ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'document_folders'
      and grantee = 'authenticated'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ),
  'authenticated users cannot mutate document folders directly'
);

select ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'document_links'
      and grantee = 'authenticated'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ),
  'authenticated users cannot mutate document links directly'
);

select ok(
  exists (
    select 1
    from storage.buckets
    where id = 'org-documents'
      and name = 'org-documents'
      and public is false
  ),
  'org-documents bucket exists and is private'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_document_folder(uuid, text, uuid, text, uuid)',
    'execute'
  ),
  'authenticated users can execute create_document_folder'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_document_upload_intent(uuid, text, uuid, uuid, text, text, text, bigint, text)',
    'execute'
  ),
  'authenticated users can execute create_document_upload_intent'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.browse_entity_documents(uuid, text, uuid, uuid)',
    'execute'
  ),
  'authenticated users can execute browse_entity_documents'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.finalize_document_upload(uuid, uuid, bigint, text)',
    'execute'
  ),
  'authenticated users can execute finalize_document_upload'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.create_document_folder(uuid, text, uuid, text, uuid)',
    'execute'
  ),
  'anonymous users cannot execute create_document_folder'
);

create temporary table _docs_fixture (
  owner_id uuid,
  billing_id uuid,
  readonly_id uuid,
  outsider_id uuid,
  org_id uuid,
  other_org_id uuid,
  client_id uuid,
  lead_id uuid,
  root_folder_id uuid,
  root_folder_version integer,
  child_folder_id uuid,
  child_folder_version integer,
  archive_folder_id uuid,
  archive_folder_version integer,
  lead_folder_id uuid,
  document_id uuid,
  document_version integer,
  link_id uuid,
  link_version integer,
  stale_document_id uuid,
  reap_document_id uuid
) on commit drop;

grant all on table _docs_fixture to authenticated;

create or replace function pg_temp.make_auth_user(p_email text, p_name text)
returns uuid
language plpgsql
as $$
declare
  created_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    created_id,
    'authenticated',
    'authenticated',
    p_email,
    extensions.crypt('docs-test-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('display_name', p_name),
    now(),
    now(),
    '',
    '',
    '',
    ''
  );
  return created_id;
end;
$$;

create or replace function pg_temp.as_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true
  );
end;
$$;
grant execute on function pg_temp.as_user(uuid) to authenticated;

insert into _docs_fixture (owner_id, billing_id, readonly_id, outsider_id)
values (
  pg_temp.make_auth_user('docs-owner@example.test', 'Docs Owner'),
  pg_temp.make_auth_user('docs-billing@example.test', 'Docs Billing'),
  pg_temp.make_auth_user('docs-readonly@example.test', 'Docs Readonly'),
  pg_temp.make_auth_user('docs-outsider@example.test', 'Docs Outsider')
);

with created_org as (
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Docs Org',
    'docs-org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id
),
other_org as (
  insert into public.organisations (name, slug, country_code)
  values (
    'Other Docs Org',
    'other-docs-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB'
  )
  returning id
)
update _docs_fixture
set
  org_id = created_org.id,
  other_org_id = other_org.id
from created_org, other_org;

insert into public.memberships (org_id, user_id, role, status)
select org_id, owner_id, 'owner', 'active' from _docs_fixture;

insert into public.memberships (org_id, user_id, role, status)
select org_id, billing_id, 'billing', 'active' from _docs_fixture;

insert into public.memberships (org_id, user_id, role, status)
select org_id, readonly_id, 'readonly', 'active' from _docs_fixture;

insert into public.memberships (org_id, user_id, role, status)
select other_org_id, outsider_id, 'owner', 'active' from _docs_fixture;

with created_client as (
  insert into public.clients (org_id, name, status)
  select org_id, 'Docs Client', 'active' from _docs_fixture
  returning id
)
update _docs_fixture set client_id = created_client.id from created_client;

with created_lead as (
  insert into public.leads (org_id, name, stage, currency)
  select org_id, 'Docs Lead', 'qualified', 'GBP' from _docs_fixture
  returning id
)
update _docs_fixture set lead_id = created_lead.id from created_lead;

-- ---------------------------------------------------------------------------
-- Cross-org denial
-- ---------------------------------------------------------------------------

select pg_temp.as_user((select outsider_id from _docs_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.browse_entity_documents(
      (select org_id from _docs_fixture),
      'client',
      (select client_id from _docs_fixture),
      null
    )
  $$,
  '42501',
  null,
  'outsider cannot browse another organisation entity documents'
);

select throws_ok(
  $$
    select public.create_document_folder(
      (select org_id from _docs_fixture),
      'client',
      (select client_id from _docs_fixture),
      'Blocked',
      null
    )
  $$,
  '42501',
  null,
  'outsider cannot create folders in another organisation'
);

select is(
  (
    select count(*)::integer
    from public.documents
    where org_id = (select org_id from _docs_fixture)
  ),
  0,
  'outsider cannot select another organisation documents via RLS'
);

-- ---------------------------------------------------------------------------
-- Billing denied browse/mutate (browse allows owner/admin/member/readonly only)
-- ---------------------------------------------------------------------------

reset role;
select pg_temp.as_user((select billing_id from _docs_fixture));
set local role authenticated;

select throws_ok(
  $$
    select public.browse_entity_documents(
      (select org_id from _docs_fixture),
      'client',
      (select client_id from _docs_fixture),
      null
    )
  $$,
  '42501',
  null,
  'billing members cannot browse entity documents'
);

select throws_ok(
  $$
    select public.create_document_folder(
      (select org_id from _docs_fixture),
      'client',
      (select client_id from _docs_fixture),
      'Billing blocked',
      null
    )
  $$,
  '42501',
  null,
  'billing members cannot create document folders'
);

select throws_ok(
  $$
    select public.create_document_upload_intent(
      (select org_id from _docs_fixture),
      'client',
      (select client_id from _docs_fixture),
      null,
      'billing.pdf',
      'other',
      'application/pdf',
      100,
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )
  $$,
  '42501',
  null,
  'billing members cannot create document upload intents'
);

select is(
  (
    select count(*)::integer
    from public.documents
    where org_id = (select org_id from _docs_fixture)
  ),
  0,
  'billing members cannot select documents via RLS'
);

-- ---------------------------------------------------------------------------
-- Readonly may browse
-- ---------------------------------------------------------------------------

reset role;
select pg_temp.as_user((select readonly_id from _docs_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.browse_entity_documents(
      (select org_id from _docs_fixture),
      'client',
      (select client_id from _docs_fixture),
      null
    )
  $$,
  'readonly members can browse entity documents'
);

-- ---------------------------------------------------------------------------
-- Folder create, duplicate sibling, invalid/cross-entity parent, cycle
-- ---------------------------------------------------------------------------

reset role;
select pg_temp.as_user((select owner_id from _docs_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.create_document_folder(
      (select org_id from _docs_fixture),
      'client',
      (select client_id from _docs_fixture),
      'Contracts',
      null
    )
  $$,
  'owner can create a root document folder'
);

update _docs_fixture
set
  root_folder_id = document_folders.id,
  root_folder_version = document_folders.version
from public.document_folders
where document_folders.org_id = _docs_fixture.org_id
  and document_folders.entity_type = 'client'
  and document_folders.entity_id = _docs_fixture.client_id
  and document_folders.name = 'Contracts'
  and document_folders.deleted_at is null;

select throws_ok(
  $$
    select public.create_document_folder(
      (select org_id from _docs_fixture),
      'client',
      (select client_id from _docs_fixture),
      'Contracts',
      null
    )
  $$,
  '23505',
  null,
  'duplicate sibling folder names conflict'
);

select throws_ok(
  $$
    select public.create_document_folder(
      (select org_id from _docs_fixture),
      'client',
      (select client_id from _docs_fixture),
      'Orphan child',
      '00000000-0000-4000-8000-000000000099'
    )
  $$,
  'P0002',
  null,
  'folder create rejects a missing parent folder'
);

select lives_ok(
  $$
    select public.create_document_folder(
      (select org_id from _docs_fixture),
      'lead',
      (select lead_id from _docs_fixture),
      'Lead Files',
      null
    )
  $$,
  'owner can create a folder on a lead entity'
);

update _docs_fixture
set lead_folder_id = document_folders.id
from public.document_folders
where document_folders.org_id = _docs_fixture.org_id
  and document_folders.entity_type = 'lead'
  and document_folders.entity_id = _docs_fixture.lead_id
  and document_folders.name = 'Lead Files'
  and document_folders.deleted_at is null;

select throws_ok(
  $$
    select public.create_document_folder(
      (select org_id from _docs_fixture),
      'client',
      (select client_id from _docs_fixture),
      'Cross entity child',
      (select lead_folder_id from _docs_fixture)
    )
  $$,
  '22023',
  null,
  'folder create rejects a parent from a different entity'
);

select lives_ok(
  $$
    select public.create_document_folder(
      (select org_id from _docs_fixture),
      'client',
      (select client_id from _docs_fixture),
      'Nested',
      (select root_folder_id from _docs_fixture)
    )
  $$,
  'owner can create a nested folder under the same entity'
);

update _docs_fixture
set
  child_folder_id = document_folders.id,
  child_folder_version = document_folders.version
from public.document_folders
where document_folders.org_id = _docs_fixture.org_id
  and document_folders.parent_id = _docs_fixture.root_folder_id
  and document_folders.name = 'Nested'
  and document_folders.deleted_at is null;

select throws_ok(
  $$
    select public.move_document_folder(
      (select org_id from _docs_fixture),
      (select root_folder_id from _docs_fixture),
      (select root_folder_version from _docs_fixture),
      (select child_folder_id from _docs_fixture)
    )
  $$,
  '22023',
  null,
  'folder move rejects a cycle into a descendant'
);

select lives_ok(
  $$
    select public.create_document_folder(
      (select org_id from _docs_fixture),
      'client',
      (select client_id from _docs_fixture),
      'Archive',
      null
    )
  $$,
  'owner can create a sibling archive folder'
);

update _docs_fixture
set
  archive_folder_id = document_folders.id,
  archive_folder_version = document_folders.version
from public.document_folders
where document_folders.org_id = _docs_fixture.org_id
  and document_folders.entity_type = 'client'
  and document_folders.entity_id = _docs_fixture.client_id
  and document_folders.name = 'Archive'
  and document_folders.deleted_at is null;

-- ---------------------------------------------------------------------------
-- Upload intent: pending_upload, server-owned path, link; finalize without object
-- ---------------------------------------------------------------------------

select lives_ok(
  $$
    select public.create_document_upload_intent(
      (select org_id from _docs_fixture),
      'client',
      (select client_id from _docs_fixture),
      null,
      'missing-object.pdf',
      'contract',
      'application/pdf',
      128,
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    )
  $$,
  'owner can create a document upload intent'
);

update _docs_fixture
set
  document_id = documents.id,
  document_version = documents.version
from public.documents
where documents.org_id = _docs_fixture.org_id
  and documents.name = 'missing-object.pdf'
  and documents.deleted_at is null;

update _docs_fixture
set
  link_id = document_links.id,
  link_version = document_links.version
from public.document_links
where document_links.org_id = _docs_fixture.org_id
  and document_links.document_id = _docs_fixture.document_id
  and document_links.deleted_at is null;

select ok(
  (
    select
      documents.status = 'pending_upload'
      and documents.storage_path
        like (
          'org/'
          || _docs_fixture.org_id::text
          || '/documents/'
          || documents.id::text
          || '/%'
        )
      and documents.bucket = 'org-documents'
      and document_links.id is not null
      and document_links.entity_type = 'client'
      and document_links.entity_id = _docs_fixture.client_id
    from _docs_fixture
    join public.documents on documents.id = _docs_fixture.document_id
    join public.document_links on document_links.id = _docs_fixture.link_id
  ),
  'upload intent creates pending_upload with server-owned org/{org}/documents/{doc}/ path and link'
);

select is(
  (
    select public.finalize_document_upload(
      org_id,
      document_id
    ) -> 'document' ->> 'status'
    from _docs_fixture
  ),
  'failed',
  'finalize without a storage.objects row marks the document failed'
);

-- ---------------------------------------------------------------------------
-- Insert storage object then finalize → ready + uploaded_at
-- ---------------------------------------------------------------------------

select lives_ok(
  $$
    select public.create_document_upload_intent(
      (select org_id from _docs_fixture),
      'client',
      (select client_id from _docs_fixture),
      null,
      'contract.pdf',
      'contract',
      'application/pdf',
      256,
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    )
  $$,
  'owner can create a second upload intent for a successful finalize'
);

update _docs_fixture
set
  document_id = documents.id,
  document_version = documents.version
from public.documents
where documents.org_id = _docs_fixture.org_id
  and documents.name = 'contract.pdf'
  and documents.deleted_at is null;

update _docs_fixture
set
  link_id = document_links.id,
  link_version = document_links.version
from public.document_links
where document_links.org_id = _docs_fixture.org_id
  and document_links.document_id = _docs_fixture.document_id
  and document_links.deleted_at is null;

reset role;
insert into storage.objects (bucket_id, name, metadata)
select
  documents.bucket,
  documents.storage_path,
  jsonb_build_object(
    'size', documents.size_bytes,
    'mimetype', documents.mime_type,
    'eTag', '"docs-test-etag"'
  )
from public.documents
join _docs_fixture on _docs_fixture.document_id = documents.id;

select pg_temp.as_user((select owner_id from _docs_fixture));
set local role authenticated;

select is(
  (
    select public.finalize_document_upload(org_id, document_id) -> 'document' ->> 'status'
    from _docs_fixture
  ),
  'ready',
  'finalize with a matching storage.objects row marks the document ready'
);

select ok(
  (
    select
      status = 'ready'
      and uploaded_at is not null
      and storage_path like (
        'org/' || org_id::text || '/documents/' || id::text || '/%'
      )
    from public.documents
    where id = (select document_id from _docs_fixture)
  ),
  'ready document has uploaded_at and keeps server-owned storage_path prefix'
);

-- ---------------------------------------------------------------------------
-- Stale/expired pending finalize + reap → orphan
-- ---------------------------------------------------------------------------

select lives_ok(
  $$
    select public.create_document_upload_intent(
      (select org_id from _docs_fixture),
      'client',
      (select client_id from _docs_fixture),
      null,
      'stale-finalize.pdf',
      'other',
      'application/pdf',
      64,
      'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
    )
  $$,
  'owner can create a pending upload that will expire before finalize'
);

update _docs_fixture
set stale_document_id = documents.id
from public.documents
where documents.org_id = _docs_fixture.org_id
  and documents.name = 'stale-finalize.pdf'
  and documents.deleted_at is null;

reset role;
update public.documents
set upload_expires_at = now() - interval '1 minute'
where id = (select stale_document_id from _docs_fixture);

select pg_temp.as_user((select owner_id from _docs_fixture));
set local role authenticated;

select is(
  (
    select public.finalize_document_upload(
      org_id,
      stale_document_id
    ) -> 'document' ->> 'status'
    from _docs_fixture
  ),
  'orphan',
  'finalize marks expired pending uploads as orphan'
);

select lives_ok(
  $$
    select public.create_document_upload_intent(
      (select org_id from _docs_fixture),
      'client',
      (select client_id from _docs_fixture),
      null,
      'stale-reap.pdf',
      'other',
      'application/pdf',
      64,
      'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    )
  $$,
  'owner can create a pending upload that will be reaped'
);

update _docs_fixture
set reap_document_id = documents.id
from public.documents
where documents.org_id = _docs_fixture.org_id
  and documents.name = 'stale-reap.pdf'
  and documents.deleted_at is null;

reset role;
update public.documents
set upload_expires_at = now() - interval '1 minute'
where id = (select reap_document_id from _docs_fixture);

select pg_temp.as_user((select owner_id from _docs_fixture));
set local role authenticated;

-- Split across statements: same-statement SELECT cannot see UPDATEs
-- performed inside reap_expired_document_uploads (statement snapshot).
select ok(
  public.reap_expired_document_uploads() >= 1,
  'reap_expired_document_uploads reaps at least one expired pending upload'
);

select is(
  (
    select status
    from public.documents
    where id = (select reap_document_id from _docs_fixture)
  ),
  'orphan',
  'reap_expired_document_uploads marks expired pending uploads as orphan'
);

-- ---------------------------------------------------------------------------
-- Soft-delete + restore document
-- ---------------------------------------------------------------------------

update _docs_fixture
set document_version = documents.version
from public.documents
where documents.id = _docs_fixture.document_id;

select lives_ok(
  $$
    select public.soft_delete_document(
      (select org_id from _docs_fixture),
      (select document_id from _docs_fixture),
      (select document_version from _docs_fixture)
    )
  $$,
  'owner can soft-delete a document'
);

select is(
  (
    select count(*)::integer
    from public.documents
    where id = (select document_id from _docs_fixture)
  ),
  0,
  'soft-deleted documents are hidden by RLS'
);

reset role;
update _docs_fixture
set document_version = documents.version
from public.documents
where documents.id = _docs_fixture.document_id;

select pg_temp.as_user((select owner_id from _docs_fixture));
set local role authenticated;

select lives_ok(
  $$
    select public.restore_document(
      (select org_id from _docs_fixture),
      (select document_id from _docs_fixture),
      (select document_version from _docs_fixture)
    )
  $$,
  'owner can restore a soft-deleted document'
);

select ok(
  exists (
    select 1
    from public.documents
    where id = (select document_id from _docs_fixture)
      and deleted_at is null
      and status = 'ready'
  ),
  'restored document is visible again'
);

-- ---------------------------------------------------------------------------
-- Move document link between folders; reject other-entity folder
-- ---------------------------------------------------------------------------

update _docs_fixture
set
  document_version = documents.version,
  link_id = document_links.id,
  link_version = document_links.version
from public.documents
join public.document_links
  on document_links.document_id = documents.id
 and document_links.org_id = documents.org_id
 and document_links.deleted_at is null
where documents.id = _docs_fixture.document_id;

select lives_ok(
  $$
    select public.move_document_link(
      (select org_id from _docs_fixture),
      (select document_id from _docs_fixture),
      'client',
      (select client_id from _docs_fixture),
      (select link_version from _docs_fixture),
      (select archive_folder_id from _docs_fixture)
    )
  $$,
  'owner can move a document link into another folder on the same entity'
);

update _docs_fixture
set link_version = document_links.version
from public.document_links
where document_links.id = _docs_fixture.link_id;

select throws_ok(
  $$
    select public.move_document_link(
      (select org_id from _docs_fixture),
      (select document_id from _docs_fixture),
      'client',
      (select client_id from _docs_fixture),
      (select link_version from _docs_fixture),
      (select lead_folder_id from _docs_fixture)
    )
  $$,
  '22023',
  null,
  'move document link rejects a folder belonging to another entity'
);

-- ---------------------------------------------------------------------------
-- Rename document and folder
-- ---------------------------------------------------------------------------

update _docs_fixture
set document_version = documents.version
from public.documents
where documents.id = _docs_fixture.document_id;

select lives_ok(
  $$
    select public.rename_document(
      (select org_id from _docs_fixture),
      (select document_id from _docs_fixture),
      (select document_version from _docs_fixture),
      'contract-renamed.pdf'
    )
  $$,
  'owner can rename a document'
);

select is(
  (
    select name
    from public.documents
    where id = (select document_id from _docs_fixture)
  ),
  'contract-renamed.pdf',
  'document rename persists the new name'
);

select lives_ok(
  $$
    select public.rename_document_folder(
      (select org_id from _docs_fixture),
      (select archive_folder_id from _docs_fixture),
      (select archive_folder_version from _docs_fixture),
      'Archive Room'
    )
  $$,
  'owner can rename a document folder'
);

update _docs_fixture
set archive_folder_version = document_folders.version
from public.document_folders
where document_folders.id = _docs_fixture.archive_folder_id;

select is(
  (
    select name
    from public.document_folders
    where id = (select archive_folder_id from _docs_fixture)
  ),
  'Archive Room',
  'folder rename persists the new name'
);

-- ---------------------------------------------------------------------------
-- Non-empty folder soft-delete rejected
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    select public.soft_delete_document_folder(
      (select org_id from _docs_fixture),
      (select archive_folder_id from _docs_fixture),
      (select archive_folder_version from _docs_fixture)
    )
  $$,
  '23514',
  null,
  'soft-delete rejects folders that still contain documents'
);

select throws_ok(
  $$
    select public.soft_delete_document_folder(
      (select org_id from _docs_fixture),
      (select root_folder_id from _docs_fixture),
      (select root_folder_version from _docs_fixture)
    )
  $$,
  '23514',
  null,
  'soft-delete rejects folders that still contain subfolders'
);

select * from finish();
rollback;

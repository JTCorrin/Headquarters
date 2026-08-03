begin;

select plan(12);

select ok(
  (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conname = 'document_folders_entity_type_check'
  ) like '%bill%',
  'document_folders entity_type check allows bill'
);

select ok(
  (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conname = 'document_links_entity_type_check'
  ) like '%bill%',
  'document_links entity_type check allows bill'
);

create temporary table _bill_docs_fixture (
  owner_id uuid,
  org_id uuid,
  vendor_id uuid,
  bill_id uuid,
  document_id uuid,
  link_id uuid,
  folder_id uuid,
  bill_version integer
) on commit drop;

grant all on table _bill_docs_fixture to authenticated;

create or replace function pg_temp.make_auth_user(p_email text, p_name text)
returns uuid
language plpgsql
as $$
declare
  created_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    created_id, 'authenticated', 'authenticated', p_email,
    extensions.crypt('bill-docs-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('display_name', p_name),
    now(), now(), '', '', '', ''
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

do $$
declare
  owner_id uuid;
  org_id uuid;
begin
  owner_id := pg_temp.make_auth_user('bill-docs-owner@example.test', 'Bill Docs Owner');

  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Bill Docs Org',
    'bill-docs-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id into org_id;

  insert into public.memberships (org_id, user_id, role, status)
  values (org_id, owner_id, 'owner', 'active');

  insert into _bill_docs_fixture (owner_id, org_id)
  values (owner_id, org_id);
end;
$$;

select pg_temp.as_user((select owner_id from _bill_docs_fixture));
set local role authenticated;

select lives_ok(
  $$
    insert into public.vendors (org_id, name, status, primary_email)
    select org_id, 'Bill Docs Vendor', 'active', 'ap@bill-docs.test'
    from _bill_docs_fixture
  $$,
  'owner can create a vendor for bill document fixture'
);

update _bill_docs_fixture
set vendor_id = (
  select id from public.vendors
  where org_id = (select org_id from _bill_docs_fixture)
    and name = 'Bill Docs Vendor'
    and deleted_at is null
  limit 1
);

select lives_ok(
  $$
    select public.create_bill_draft(
      (select org_id from _bill_docs_fixture),
      jsonb_build_object(
        'vendor_id', (select vendor_id from _bill_docs_fixture),
        'number', 'BILL-DOC-1',
        'currency', 'GBP',
        'due_on', (current_date + 14)::text
      ),
      '[]'::jsonb
    )
  $$,
  'owner can create a draft bill for document entity tests'
);

update _bill_docs_fixture
set
  bill_id = bills.id,
  bill_version = bills.version
from public.bills
where bills.org_id = _bill_docs_fixture.org_id
  and bills.number = 'BILL-DOC-1'
  and bills.deleted_at is null;

select throws_ok(
  $$
    select public.create_document_folder(
      (select org_id from _bill_docs_fixture),
      'bill',
      '00000000-0000-4000-8000-000000000099',
      'Missing Bill',
      null
    )
  $$,
  '22023',
  null,
  'bill folder create rejects a missing bill id'
);

select lives_ok(
  $$
    select public.create_document_folder(
      (select org_id from _bill_docs_fixture),
      'bill',
      (select bill_id from _bill_docs_fixture),
      'Source',
      null
    )
  $$,
  'owner can create a document folder on a bill'
);

update _bill_docs_fixture
set folder_id = document_folders.id
from public.document_folders
where document_folders.org_id = _bill_docs_fixture.org_id
  and document_folders.entity_type = 'bill'
  and document_folders.entity_id = _bill_docs_fixture.bill_id
  and document_folders.name = 'Source'
  and document_folders.deleted_at is null;

select lives_ok(
  $$
    select public.create_document_upload_intent(
      (select org_id from _bill_docs_fixture),
      'bill',
      (select bill_id from _bill_docs_fixture),
      (select folder_id from _bill_docs_fixture),
      'vendor-invoice.pdf',
      'invoice',
      'application/pdf',
      2048,
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    )
  $$,
  'owner can create a bill-scoped document upload intent'
);

update _bill_docs_fixture
set document_id = documents.id
from public.documents
where documents.org_id = _bill_docs_fixture.org_id
  and documents.name = 'vendor-invoice.pdf'
  and documents.deleted_at is null;

update _bill_docs_fixture
set link_id = document_links.id
from public.document_links
where document_links.org_id = _bill_docs_fixture.org_id
  and document_links.document_id = _bill_docs_fixture.document_id
  and document_links.deleted_at is null;

select ok(
  (
    select
      documents.status = 'pending_upload'
      and document_links.entity_type = 'bill'
      and document_links.entity_id = _bill_docs_fixture.bill_id
      and document_links.folder_id = _bill_docs_fixture.folder_id
    from _bill_docs_fixture
    join public.documents on documents.id = _bill_docs_fixture.document_id
    join public.document_links on document_links.id = _bill_docs_fixture.link_id
  ),
  'bill upload intent links the document to the bill entity'
);

select ok(
  exists (
    select 1
    from jsonb_array_elements(
      public.browse_entity_documents(
        (select org_id from _bill_docs_fixture),
        'bill',
        (select bill_id from _bill_docs_fixture),
        (select folder_id from _bill_docs_fixture)
      ) -> 'documents'
    ) as elem
    where elem -> 'document' ->> 'id'
      = (select document_id::text from _bill_docs_fixture)
  ),
  'browse_entity_documents returns bill-scoped documents'
);

select lives_ok(
  $$
    select public.save_bill_draft(
      (select bill_id from _bill_docs_fixture),
      (select org_id from _bill_docs_fixture),
      (select bill_version from _bill_docs_fixture),
      jsonb_build_object(
        'attachment_document_id', (select document_id from _bill_docs_fixture)
      ),
      null
    )
  $$,
  'bill draft can attach a same-org document via attachment_document_id'
);

select is(
  (
    select attachment_document_id
    from public.bills
    where id = (select bill_id from _bill_docs_fixture)
  ),
  (select document_id from _bill_docs_fixture),
  'bill attachment_document_id persists after save'
);

select throws_ok(
  $$
    select public.save_bill_draft(
      (select bill_id from _bill_docs_fixture),
      (select org_id from _bill_docs_fixture),
      (select version from public.bills where id = (select bill_id from _bill_docs_fixture)),
      jsonb_build_object(
        'attachment_document_id', '00000000-0000-4000-8000-000000000099'
      ),
      null
    )
  $$,
  '22023',
  null,
  'bill attachment rejects a missing document id'
);

select * from finish();
rollback;

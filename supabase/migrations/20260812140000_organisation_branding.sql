-- Organisation letterhead branding: structured address columns + private org-assets bucket.

set search_path = public, extensions, pg_catalog;

alter table public.organisations
  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists city text,
  add column if not exists region text,
  add column if not exists postal_code text;

alter table public.organisations
  drop constraint if exists organisations_address_line1_length_check,
  drop constraint if exists organisations_address_line2_length_check,
  drop constraint if exists organisations_city_length_check,
  drop constraint if exists organisations_region_length_check,
  drop constraint if exists organisations_postal_code_length_check;

alter table public.organisations
  add constraint organisations_address_line1_length_check
    check (address_line1 is null or char_length(address_line1) <= 200),
  add constraint organisations_address_line2_length_check
    check (address_line2 is null or char_length(address_line2) <= 200),
  add constraint organisations_city_length_check
    check (city is null or char_length(city) <= 120),
  add constraint organisations_region_length_check
    check (region is null or char_length(region) <= 120),
  add constraint organisations_postal_code_length_check
    check (postal_code is null or char_length(postal_code) <= 32);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'org-assets',
  'org-assets',
  false,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Default-deny for authenticated; service role issues signed URLs.
-- Restrictive tenant-path guards mirror org-documents.
drop policy if exists org_assets_tenant_path_select on storage.objects;
drop policy if exists org_assets_tenant_path_insert on storage.objects;
drop policy if exists org_assets_tenant_path_update on storage.objects;
drop policy if exists org_assets_tenant_path_delete on storage.objects;

create policy org_assets_tenant_path_select
on storage.objects
as restrictive
for select
to authenticated
using (
  bucket_id is distinct from 'org-assets'
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
      array['owner', 'admin', 'member', 'readonly', 'billing']
    )
  )
);

create policy org_assets_tenant_path_insert
on storage.objects
as restrictive
for insert
to authenticated
with check (
  bucket_id is distinct from 'org-assets'
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
      array['owner']
    )
  )
);

create policy org_assets_tenant_path_update
on storage.objects
as restrictive
for update
to authenticated
using (
  bucket_id is distinct from 'org-assets'
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
      array['owner']
    )
  )
)
with check (
  bucket_id is distinct from 'org-assets'
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
      array['owner']
    )
  )
);

create policy org_assets_tenant_path_delete
on storage.objects
as restrictive
for delete
to authenticated
using (
  bucket_id is distinct from 'org-assets'
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
      array['owner']
    )
  )
);

-- Column-level UPDATE grants from multi_org_configuration do not cover new columns.
grant update (
  address_line1,
  address_line2,
  city,
  region,
  postal_code
) on table public.organisations to authenticated;

-- Allow owners/admins to update letterhead address columns on organisations.
-- Column-level UPDATE grants from multi_org_configuration predate these fields;
-- every configuration PATCH now includes them and fails without this grant.

set search_path = public, extensions, pg_catalog;

grant update (
  address_line1,
  address_line2,
  city,
  region,
  postal_code
) on table public.organisations to authenticated;

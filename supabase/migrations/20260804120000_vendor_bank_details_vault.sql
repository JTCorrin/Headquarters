-- S3: vendor bank details via private.store_secret (mailbox secret_ref pattern).
-- Plaintext bank_details_encrypted stays revoked/dead.

alter table public.vendors
  add column if not exists bank_details_secret_ref uuid;

comment on column public.vendors.bank_details_secret_ref is
  'Opaque pointer to private.integration_secrets; never granted to authenticated.';

-- Keep the legacy column dead for authenticated writers (idempotent with prior revoke).
revoke insert (bank_details_encrypted) on table public.vendors from authenticated;
revoke update (bank_details_encrypted) on table public.vendors from authenticated;

-- Never expose secret_ref (or legacy plaintext column) via PostgREST grants.
revoke select (bank_details_secret_ref) on table public.vendors from authenticated;
revoke select (bank_details_encrypted) on table public.vendors from authenticated;

create or replace function public.set_vendor_bank_details(
  p_org_id uuid,
  p_vendor_id uuid,
  p_bank_details text,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  vendor_row public.vendors;
  new_secret uuid;
  old_secret uuid;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  if p_bank_details is null or length(trim(p_bank_details)) = 0 then
    raise exception 'Bank details are required'
      using errcode = '22023';
  end if;

  if length(p_bank_details) > 8192 then
    raise exception 'Bank details are too large'
      using errcode = '22023';
  end if;

  select * into vendor_row
  from public.vendors
  where vendors.id = p_vendor_id
    and vendors.org_id = p_org_id
    and vendors.deleted_at is null
  for update;

  if not found then
    raise exception 'Vendor not found'
      using errcode = 'P0002';
  end if;

  if vendor_row.version is distinct from p_expected_version then
    raise exception 'Vendor version conflict'
      using errcode = 'P0001';
  end if;

  old_secret := vendor_row.bank_details_secret_ref;
  new_secret := private.store_secret(trim(p_bank_details));

  update public.vendors
  set
    bank_details_secret_ref = new_secret,
    bank_details_encrypted = null,
    updated_by = actor_id,
    version = vendor_row.version + 1
  where vendors.id = vendor_row.id
    and vendors.org_id = vendor_row.org_id
  returning * into vendor_row;

  if old_secret is not null and old_secret is distinct from new_secret then
    perform private.delete_secret(old_secret);
  end if;

  return jsonb_build_object(
    'id', vendor_row.id,
    'org_id', vendor_row.org_id,
    'version', vendor_row.version,
    'bank_details_configured', true,
    'updated_at', vendor_row.updated_at
  );
end;
$$;

create or replace function public.clear_vendor_bank_details(
  p_org_id uuid,
  p_vendor_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  vendor_row public.vendors;
  old_secret uuid;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into vendor_row
  from public.vendors
  where vendors.id = p_vendor_id
    and vendors.org_id = p_org_id
    and vendors.deleted_at is null
  for update;

  if not found then
    raise exception 'Vendor not found'
      using errcode = 'P0002';
  end if;

  if vendor_row.version is distinct from p_expected_version then
    raise exception 'Vendor version conflict'
      using errcode = 'P0001';
  end if;

  old_secret := vendor_row.bank_details_secret_ref;

  update public.vendors
  set
    bank_details_secret_ref = null,
    bank_details_encrypted = null,
    updated_by = actor_id,
    version = vendor_row.version + 1
  where vendors.id = vendor_row.id
    and vendors.org_id = vendor_row.org_id
  returning * into vendor_row;

  if old_secret is not null then
    perform private.delete_secret(old_secret);
  end if;

  return jsonb_build_object(
    'id', vendor_row.id,
    'org_id', vendor_row.org_id,
    'version', vendor_row.version,
    'bank_details_configured', false,
    'updated_at', vendor_row.updated_at
  );
end;
$$;

create or replace function public.read_vendor_bank_details(
  p_org_id uuid,
  p_vendor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  vendor_row public.vendors;
  plaintext text;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into vendor_row
  from public.vendors
  where vendors.id = p_vendor_id
    and vendors.org_id = p_org_id
    and vendors.deleted_at is null;

  if not found then
    raise exception 'Vendor not found'
      using errcode = 'P0002';
  end if;

  if vendor_row.bank_details_secret_ref is null then
    return jsonb_build_object(
      'id', vendor_row.id,
      'org_id', vendor_row.org_id,
      'version', vendor_row.version,
      'bank_details_configured', false,
      'bank_details', null
    );
  end if;

  plaintext := private.read_secret(vendor_row.bank_details_secret_ref);

  return jsonb_build_object(
    'id', vendor_row.id,
    'org_id', vendor_row.org_id,
    'version', vendor_row.version,
    'bank_details_configured', true,
    'bank_details', plaintext
  );
end;
$$;

-- Soft-delete clears vault-backed bank secrets (replace definition).
create or replace function public.soft_delete_vendor(
  p_vendor_id uuid,
  p_org_id uuid,
  p_expected_version integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  vendor_row public.vendors;
  old_secret uuid;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  select * into vendor_row
  from public.vendors
  where vendors.id = p_vendor_id
    and vendors.org_id = p_org_id
    and vendors.deleted_at is null
  for update;

  if not found then
    raise exception 'Vendor not found'
      using errcode = 'P0002';
  end if;

  if vendor_row.version is distinct from p_expected_version then
    raise exception 'Vendor version conflict'
      using errcode = 'P0001';
  end if;

  old_secret := vendor_row.bank_details_secret_ref;

  update public.vendors
  set
    deleted_at = now(),
    bank_details_secret_ref = null,
    bank_details_encrypted = null,
    updated_by = actor_id
  where vendors.id = vendor_row.id;

  if old_secret is not null then
    perform private.delete_secret(old_secret);
  end if;
end;
$$;

revoke all on function public.set_vendor_bank_details(uuid, uuid, text, integer)
  from public, anon;
revoke all on function public.clear_vendor_bank_details(uuid, uuid, integer)
  from public, anon;
revoke all on function public.read_vendor_bank_details(uuid, uuid)
  from public, anon;

grant execute on function public.set_vendor_bank_details(uuid, uuid, text, integer)
  to authenticated;
grant execute on function public.clear_vendor_bank_details(uuid, uuid, integer)
  to authenticated;
grant execute on function public.read_vendor_bank_details(uuid, uuid)
  to authenticated;

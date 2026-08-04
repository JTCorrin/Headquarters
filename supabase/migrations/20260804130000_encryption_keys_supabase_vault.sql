-- S4: move co-located private.encryption_keys into Supabase Vault; add rotation.
-- Ciphertext rows stay in private.integration_secrets; only the pgp key leaves the DB heap.

create extension if not exists supabase_vault with schema vault;

-- Active key pointer (name of vault.secrets row). Single-row meta.
create table if not exists private.encryption_key_meta (
  id integer primary key default 1 check (id = 1),
  active_key_name text not null,
  rotated_at timestamptz
);

revoke all on table private.encryption_key_meta from public, anon, authenticated;

-- Drop FK so key_id can reference Vault secret names instead of private.encryption_keys.
alter table private.integration_secrets
  drop constraint if exists integration_secrets_key_id_fkey;

do $$
declare
  old_key bytea;
  key_hex text;
begin
  select encryption_keys.key
  into old_key
  from private.encryption_keys
  where encryption_keys.id = 'v1';

  if old_key is null then
    key_hex := encode(extensions.gen_random_bytes(32), 'hex');
  else
    key_hex := encode(old_key, 'hex');
  end if;

  if not exists (
    select 1 from vault.secrets where name = 'crm_enc_key_v1'
  ) then
    perform vault.create_secret(
      key_hex,
      'crm_enc_key_v1',
      'CRM pgp key for private.integration_secrets (moved off private.encryption_keys)'
    );
  end if;

  insert into private.encryption_key_meta (id, active_key_name, rotated_at)
  values (1, 'crm_enc_key_v1', null)
  on conflict (id) do update
    set active_key_name = excluded.active_key_name;

  update private.integration_secrets
  set key_id = 'crm_enc_key_v1'
  where key_id = 'v1';
end;
$$;

-- Root key no longer co-located with ciphertext.
drop table if exists private.encryption_keys;

create or replace function private.active_encryption_key_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encryption_key_meta.active_key_name
  from private.encryption_key_meta
  where encryption_key_meta.id = 1;
$$;

create or replace function private.encryption_key_hex(p_key_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  key_hex text;
begin
  select decrypted_secrets.decrypted_secret
  into key_hex
  from vault.decrypted_secrets as decrypted_secrets
  where decrypted_secrets.name = p_key_name;

  if key_hex is null or length(key_hex) = 0 then
    raise exception 'Encryption key % is missing from Vault', p_key_name
      using errcode = 'P0001';
  end if;

  return key_hex;
end;
$$;

create or replace function private.store_secret(p_plaintext text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret_id uuid := gen_random_uuid();
  key_name text := private.active_encryption_key_name();
  enc_key_hex text;
begin
  if p_plaintext is null or length(p_plaintext) = 0 then
    raise exception 'Secret plaintext is required'
      using errcode = '22023';
  end if;
  if length(p_plaintext) > 8192 then
    raise exception 'Secret plaintext is too large'
      using errcode = '22023';
  end if;

  if key_name is null then
    raise exception 'Active encryption key is not configured'
      using errcode = 'P0001';
  end if;

  enc_key_hex := private.encryption_key_hex(key_name);

  insert into private.integration_secrets (id, ciphertext, key_id)
  values (
    secret_id,
    extensions.pgp_sym_encrypt(p_plaintext, enc_key_hex),
    key_name
  );

  return secret_id;
end;
$$;

create or replace function private.read_secret(p_secret_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  blob bytea;
  key_name text;
  enc_key_hex text;
begin
  if p_secret_id is null then
    return null;
  end if;

  select integration_secrets.ciphertext, integration_secrets.key_id
  into blob, key_name
  from private.integration_secrets
  where integration_secrets.id = p_secret_id;

  if blob is null then
    return null;
  end if;

  enc_key_hex := private.encryption_key_hex(key_name);
  return extensions.pgp_sym_decrypt(blob, enc_key_hex);
end;
$$;

-- Re-encrypt all integration secrets under a new Vault-backed key.
create or replace function private.rotate_encryption_key()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_name text := private.active_encryption_key_name();
  new_name text;
  new_hex text := encode(extensions.gen_random_bytes(32), 'hex');
  version_num integer;
  secret_row record;
  plaintext text;
begin
  if old_name is null then
    raise exception 'Active encryption key is not configured'
      using errcode = 'P0001';
  end if;

  version_num := coalesce(
    nullif(substring(old_name from 'crm_enc_key_v([0-9]+)$'), '')::integer,
    1
  ) + 1;
  new_name := 'crm_enc_key_v' || version_num::text;

  if exists (select 1 from vault.secrets where name = new_name) then
    raise exception 'Vault secret % already exists', new_name
      using errcode = '23505';
  end if;

  perform vault.create_secret(
    new_hex,
    new_name,
    'CRM pgp key rotation from ' || old_name
  );

  for secret_row in
    select integration_secrets.id, integration_secrets.ciphertext, integration_secrets.key_id
    from private.integration_secrets
  loop
    plaintext := extensions.pgp_sym_decrypt(
      secret_row.ciphertext,
      private.encryption_key_hex(secret_row.key_id)
    );
    update private.integration_secrets
    set
      ciphertext = extensions.pgp_sym_encrypt(plaintext, new_hex),
      key_id = new_name,
      rotated_at = now()
    where integration_secrets.id = secret_row.id;
  end loop;

  update private.encryption_key_meta
  set
    active_key_name = new_name,
    rotated_at = now()
  where encryption_key_meta.id = 1;

  -- Keep prior Vault secret for emergency decrypt of any missed rows; operators
  -- may delete crm_enc_key_vN-1 after verifying rotation.
  return new_name;
end;
$$;

-- Owner-facing rotation entry (org owner). Does not return key material.
create or replace function public.rotate_org_encryption_key(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  new_name text;
begin
  if actor_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  if not private.has_org_role(p_org_id, array['owner']) then
    raise exception 'This action is not permitted'
      using errcode = '42501';
  end if;

  -- Org id gates authz; key material is project-global (same as mailbox secrets).
  new_name := private.rotate_encryption_key();

  return jsonb_build_object(
    'active_key_name', new_name,
    'rotated_at', now()
  );
end;
$$;

revoke all on function private.active_encryption_key_name() from public, anon, authenticated;
revoke all on function private.encryption_key_hex(text) from public, anon, authenticated;
revoke all on function private.rotate_encryption_key() from public, anon, authenticated;
revoke all on function public.rotate_org_encryption_key(uuid) from public, anon;

grant execute on function public.rotate_org_encryption_key(uuid) to authenticated;

-- store_secret / read_secret / delete_secret remain ungranted to authenticated.

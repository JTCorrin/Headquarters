#!/usr/bin/env bash
# Two-session concurrency proof for contact primary takeover / cross-swap.
# Usage: contact_primary_takeover_concurrency.sh <supabase_db_container_name>
set -euo pipefail

db_container="${1:?database container name required}"

psql_db() {
  docker exec -i "${db_container}" \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 --no-psqlrc "$@"
}

sql_scalar() {
  psql_db -Atq -c "$1" | awk 'NF { print; exit }' | tr -d '\r'
}

cleanup() {
  if [[ -n "${owner_id:-}" ]]; then
    psql_db >/dev/null <<SQL || true
begin;
delete from public.client_contacts where org_id = '${org_id:-00000000-0000-0000-0000-000000000000}';
delete from public.contacts where org_id = '${org_id:-00000000-0000-0000-0000-000000000000}';
delete from public.clients where org_id = '${org_id:-00000000-0000-0000-0000-000000000000}';
delete from public.memberships where org_id = '${org_id:-00000000-0000-0000-0000-000000000000}';
delete from public.organisations where id = '${org_id:-00000000-0000-0000-0000-000000000000}';
delete from auth.users where id = '${owner_id}';
commit;
SQL
  fi
  if [[ -n "${t1_pid:-}" ]]; then
    kill "${t1_pid}" 2>/dev/null || true
  fi
  if [[ -n "${t2_pid:-}" ]]; then
    kill "${t2_pid}" 2>/dev/null || true
  fi
  rm -f "${t1_log:-}" "${t2_log:-}"
}
trap cleanup EXIT

owner_id="$(sql_scalar "select gen_random_uuid();")"
t1_log="$(mktemp)"
t2_log="$(mktemp)"

psql_db >/dev/null <<SQL
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000',
  '${owner_id}'::uuid,
  'authenticated',
  'authenticated',
  'primary-lock-${owner_id}@example.test',
  extensions.crypt('primary-lock-password', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Primary Lock Owner"}'::jsonb,
  now(),
  now(),
  '', '', '', ''
);
SQL

org_id="$(sql_scalar "
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Primary Lock Org',
    'primary-lock-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id;
")"

psql_db >/dev/null <<SQL
insert into public.memberships (org_id, user_id, role, status)
values ('${org_id}'::uuid, '${owner_id}'::uuid, 'owner', 'active');
SQL

client_1="$(sql_scalar "
  insert into public.clients (org_id, name, status, default_currency, created_by, updated_by)
  values ('${org_id}'::uuid, 'Client One', 'active', 'GBP', '${owner_id}'::uuid, '${owner_id}'::uuid)
  returning id;
")"
client_2="$(sql_scalar "
  insert into public.clients (org_id, name, status, default_currency, created_by, updated_by)
  values ('${org_id}'::uuid, 'Client Two', 'active', 'USD', '${owner_id}'::uuid, '${owner_id}'::uuid)
  returning id;
")"

contact_a="$(sql_scalar "
  insert into public.contacts (org_id, display_name, primary_email, created_by, updated_by)
  values ('${org_id}'::uuid, 'Contact A', 'a-${owner_id}@example.test', '${owner_id}'::uuid, '${owner_id}'::uuid)
  returning id;
")"
contact_b="$(sql_scalar "
  insert into public.contacts (org_id, display_name, primary_email, created_by, updated_by)
  values ('${org_id}'::uuid, 'Contact B', 'b-${owner_id}@example.test', '${owner_id}'::uuid, '${owner_id}'::uuid)
  returning id;
")"

# A primary on client_1; B primary on client_2; each also has a non-primary link on the other.
psql_db >/dev/null <<SQL
insert into public.client_contacts (
  org_id, client_id, contact_id, role, is_primary, created_by, updated_by
) values
  ('${org_id}'::uuid, '${client_1}'::uuid, '${contact_a}'::uuid, 'primary', true, '${owner_id}'::uuid, '${owner_id}'::uuid),
  ('${org_id}'::uuid, '${client_2}'::uuid, '${contact_a}'::uuid, 'billing', false, '${owner_id}'::uuid, '${owner_id}'::uuid),
  ('${org_id}'::uuid, '${client_2}'::uuid, '${contact_b}'::uuid, 'primary', true, '${owner_id}'::uuid, '${owner_id}'::uuid),
  ('${org_id}'::uuid, '${client_1}'::uuid, '${contact_b}'::uuid, 'billing', false, '${owner_id}'::uuid, '${owner_id}'::uuid);
SQL

version_a="$(sql_scalar "select version from public.contacts where id = '${contact_a}'::uuid;")"
version_b="$(sql_scalar "select version from public.contacts where id = '${contact_b}'::uuid;")"

echo "fixture org=${org_id} A=${contact_a}@v${version_a} B=${contact_b}@v${version_b}"

auth_prefix() {
  local uid="$1"
  cat <<SQL
select set_config('request.jwt.claim.sub', '${uid}', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '${uid}', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
SQL
}

# Cross-swap in two real sessions: A→client_2 and B→client_1.
psql_db >"${t1_log}" 2>&1 <<SQL &
begin;
$(auth_prefix "${owner_id}")
select public.update_contact_with_primary_client(
  '${contact_a}'::uuid,
  '${org_id}'::uuid,
  ${version_a},
  '{}'::jsonb,
  '${client_2}'::uuid,
  true
);
commit;
SQL
t1_pid=$!

psql_db >"${t2_log}" 2>&1 <<SQL &
begin;
$(auth_prefix "${owner_id}")
select public.update_contact_with_primary_client(
  '${contact_b}'::uuid,
  '${org_id}'::uuid,
  ${version_b},
  '{}'::jsonb,
  '${client_1}'::uuid,
  true
);
commit;
SQL
t2_pid=$!

set +e
wait "${t1_pid}"
t1_status=$?
wait "${t2_pid}"
t2_status=$?
set -e
t1_pid=""
t2_pid=""

if [[ "${t1_status}" -ne 0 || "${t2_status}" -ne 0 ]]; then
  echo "cross-swap sessions failed (t1=${t1_status} t2=${t2_status}) — possible deadlock or error" >&2
  cat "${t1_log}" >&2 || true
  cat "${t2_log}" >&2 || true
  exit 1
fi

# Invariants after swap
primary_counts="$(sql_scalar "
  select
    (select count(*)::text from public.client_contacts
      where client_id = '${client_1}'::uuid and is_primary and deleted_at is null) || E'\t' ||
    (select count(*)::text from public.client_contacts
      where client_id = '${client_2}'::uuid and is_primary and deleted_at is null) || E'\t' ||
    (select count(*)::text from public.client_contacts
      where contact_id = '${contact_a}'::uuid and is_primary and deleted_at is null) || E'\t' ||
    (select count(*)::text from public.client_contacts
      where contact_id = '${contact_b}'::uuid and is_primary and deleted_at is null);
")"
primary_counts="$(printf '%s' "${primary_counts}" | tr -d '\r')"

c1_primaries="$(printf '%s' "${primary_counts}" | cut -f1)"
c2_primaries="$(printf '%s' "${primary_counts}" | cut -f2)"
a_primaries="$(printf '%s' "${primary_counts}" | cut -f3)"
b_primaries="$(printf '%s' "${primary_counts}" | cut -f4)"

if [[ "${c1_primaries}" != "1" || "${c2_primaries}" != "1" || "${a_primaries}" != "1" || "${b_primaries}" != "1" ]]; then
  echo "post-swap primary counts invalid: clients=${c1_primaries}/${c2_primaries} contacts=${a_primaries}/${b_primaries}" >&2
  exit 1
fi

new_version_a="$(sql_scalar "select version from public.contacts where id = '${contact_a}'::uuid;")"
new_version_b="$(sql_scalar "select version from public.contacts where id = '${contact_b}'::uuid;")"

if [[ "${new_version_a}" -le "${version_a}" || "${new_version_b}" -le "${version_b}" ]]; then
  echo "expected both contact versions to advance after swap; A ${version_a}->${new_version_a} B ${version_b}->${new_version_b}" >&2
  exit 1
fi

# Takeover race: reset so A is primary on client_1; B has non-primary link only.
psql_db >/dev/null <<SQL
update public.client_contacts
set is_primary = false, role = 'billing'
where org_id = '${org_id}'::uuid;

update public.client_contacts
set is_primary = true, role = 'primary'
where client_id = '${client_1}'::uuid and contact_id = '${contact_a}'::uuid;

update public.contacts set updated_by = '${owner_id}'::uuid
where id in ('${contact_a}'::uuid, '${contact_b}'::uuid);
SQL

version_a="$(sql_scalar "select version from public.contacts where id = '${contact_a}'::uuid;")"
version_b="$(sql_scalar "select version from public.contacts where id = '${contact_b}'::uuid;")"

# Concurrent takeovers of the same client by B (twice) should leave one primary and bump A.
psql_db >"${t1_log}" 2>&1 <<SQL &
begin;
$(auth_prefix "${owner_id}")
select public.update_contact_with_primary_client(
  '${contact_b}'::uuid,
  '${org_id}'::uuid,
  ${version_b},
  '{}'::jsonb,
  '${client_1}'::uuid,
  true
);
commit;
SQL
t1_pid=$!

# Second session uses the same expected version; one may hit version conflict if
# the first bumps B first — both outcomes are acceptable if invariants hold.
psql_db >"${t2_log}" 2>&1 <<SQL &
begin;
$(auth_prefix "${owner_id}")
select public.update_contact_with_primary_client(
  '${contact_b}'::uuid,
  '${org_id}'::uuid,
  ${version_b},
  '{}'::jsonb,
  '${client_1}'::uuid,
  true
);
commit;
SQL
t2_pid=$!

set +e
wait "${t1_pid}"
t1_status=$?
wait "${t2_pid}"
t2_status=$?
set -e
t1_pid=""
t2_pid=""

if [[ "${t1_status}" -ne 0 && "${t2_status}" -ne 0 ]]; then
  echo "both takeover sessions failed" >&2
  cat "${t1_log}" >&2 || true
  cat "${t2_log}" >&2 || true
  exit 1
fi

takeover_primary="$(sql_scalar "
  select contact_id::text
  from public.client_contacts
  where client_id = '${client_1}'::uuid
    and is_primary
    and deleted_at is null;
")"
takeover_primary="$(printf '%s' "${takeover_primary}" | tr -d '\r')"

if [[ "${takeover_primary}" != "${contact_b}" ]]; then
  echo "expected B to be primary on client_1 after takeover, got ${takeover_primary}" >&2
  exit 1
fi

displaced_version="$(sql_scalar "select version from public.contacts where id = '${contact_a}'::uuid;")"
if [[ "${displaced_version}" -le "${version_a}" ]]; then
  echo "displaced contact A version did not advance (${version_a} -> ${displaced_version})" >&2
  cat "${t1_log}" >&2 || true
  cat "${t2_log}" >&2 || true
  exit 1
fi

# Stale If-Match on displaced A must fail.
set +e
stale_out="$(
  psql_db -v ON_ERROR_STOP=1 <<SQL 2>&1
begin;
$(auth_prefix "${owner_id}")
select public.update_contact_with_primary_client(
  '${contact_a}'::uuid,
  '${org_id}'::uuid,
  ${version_a},
  jsonb_build_object('display_name', 'Stale A'),
  null,
  false
);
commit;
SQL
)"
stale_status=$?
set -e

if [[ "${stale_status}" -eq 0 ]]; then
  echo "stale If-Match on displaced contact unexpectedly succeeded" >&2
  printf '%s\n' "${stale_out}" >&2
  exit 1
fi

if ! printf '%s' "${stale_out}" | grep -qi 'version conflict\|P0001'; then
  echo "expected version conflict for displaced stale If-Match, got:" >&2
  printf '%s\n' "${stale_out}" >&2
  exit 1
fi

echo "ok - two-session primary cross-swap + takeover preserved invariants and bumped displaced ETags"

#!/usr/bin/env bash
# Two-session GET/save lock interleaving for quote drafts.
# Usage: quote_document_lock_interleave.sh <supabase_db_container_name>
set -euo pipefail

db_container="${1:?database container name required}"

psql_db() {
  docker exec -i "${db_container}" \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 --no-psqlrc "$@"
}

# -q suppresses INSERT/UPDATE command tags that otherwise pollute -At captures.
sql_scalar() {
  psql_db -Atq -c "$1" | awk 'NF { print; exit }' | tr -d '\r'
}

cleanup() {
  if [[ -n "${owner_id:-}" ]]; then
    # Delete org first so the active-owner trigger does not block membership removal.
    psql_db >/dev/null <<SQL || true
begin;
select set_config('app.allow_quote_totals', 'on', true);
delete from public.quote_lines where quote_id = '${quote_id:-00000000-0000-0000-0000-000000000000}';
delete from public.quotes where id = '${quote_id:-00000000-0000-0000-0000-000000000000}';
delete from public.clients where id = '${client_id:-00000000-0000-0000-0000-000000000000}';
delete from public.document_sequences where org_id = '${org_id:-00000000-0000-0000-0000-000000000000}';
delete from public.organisations where id = '${org_id:-00000000-0000-0000-0000-000000000000}';
delete from public.memberships where org_id = '${org_id:-00000000-0000-0000-0000-000000000000}';
delete from auth.users where id = '${owner_id}';
commit;
SQL
  fi
  if [[ -n "${reader_pid:-}" ]]; then
    kill "${reader_pid}" 2>/dev/null || true
  fi
  if [[ -n "${saver_pid:-}" ]]; then
    kill "${saver_pid}" 2>/dev/null || true
  fi
  rm -f "${reader_log:-}" "${saver_log:-}"
}
trap cleanup EXIT

owner_id="$(sql_scalar "select gen_random_uuid();")"
reader_log="$(mktemp)"
saver_log="$(mktemp)"

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
  'quote-lock-${owner_id}@example.test',
  extensions.crypt('quotes-lock-password', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Quote Lock Owner"}'::jsonb,
  now(),
  now(),
  '', '', '', ''
);
SQL

org_id="$(sql_scalar "
  insert into public.organisations (name, slug, country_code, default_currency)
  values (
    'Quote Lock Org',
    'quote-lock-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    'GB',
    'GBP'
  )
  returning id;
")"

psql_db >/dev/null <<SQL
insert into public.document_sequences (org_id, document_type, prefix, next_number, padding)
values ('${org_id}'::uuid, 'quote', 'Q-', 1, 4)
on conflict do nothing;

insert into public.memberships (org_id, user_id, role, status)
values ('${org_id}'::uuid, '${owner_id}'::uuid, 'owner', 'active');
SQL

client_id="$(sql_scalar "
  insert into public.clients (org_id, name, status)
  values ('${org_id}'::uuid, 'Lock Client', 'active')
  returning id;
")"

# set_config(..., true) is transaction-local; wrap so auth GUCs survive until create_quote_draft.
created="$(psql_db -Atq -F $'\t' <<SQL
begin;
select set_config('request.jwt.claim.sub', '${owner_id}', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '${owner_id}', 'role', 'authenticated')::text,
  true
);
select
  (payload -> 'quote' ->> 'id') || E'\t' || (payload -> 'quote' ->> 'version')
from (
  select public.create_quote_draft(
    '${org_id}'::uuid,
    jsonb_build_object(
      'title', 'Lock probe',
      'client_id', '${client_id}'::uuid,
      'currency', 'GBP'
    ),
    jsonb_build_array(
      jsonb_build_object(
        'description', 'Before save',
        'quantity', 1,
        'unit_price_cents', 100,
        'tax_rate_percent', 0,
        'position', 0
      )
    )
  ) as payload
) created;
commit;
SQL
)"

# Multiple SELECTs each emit a line; keep the last non-empty result row.
created_line="$(printf '%s\n' "${created}" | awk 'NF { line=$0 } END { print line }' | tr -d '\r')"
quote_id="$(printf '%s' "${created_line}" | cut -f1)"
quote_version="$(printf '%s' "${created_line}" | cut -f2)"

if [[ ! "${owner_id}" =~ ^[0-9a-f-]{36}$ || ! "${org_id}" =~ ^[0-9a-f-]{36}$ || ! "${client_id}" =~ ^[0-9a-f-]{36}$ ]]; then
  echo "failed to capture fixture ids (owner='${owner_id}' org='${org_id}' client='${client_id}')" >&2
  exit 1
fi

if [[ ! "${quote_id}" =~ ^[0-9a-f-]{36}$ || ! "${quote_version}" =~ ^[0-9]+$ ]]; then
  echo "failed to create lock-probe fixture (created='${created}')" >&2
  exit 1
fi

echo "fixture org=${org_id} quote=${quote_id} version=${quote_version}"

psql_db >"${reader_log}" 2>&1 <<SQL &
begin;
select set_config('request.jwt.claim.sub', '${owner_id}', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '${owner_id}', 'role', 'authenticated')::text,
  true
);
select public.get_quote_document('${quote_id}'::uuid, '${org_id}'::uuid);
-- Hold the transaction (and FOR SHARE) after get returns; query text becomes pg_sleep.
select pg_sleep(8);
commit;
SQL
reader_pid=$!

# After get_quote_document returns, pg_stat_activity.query is pg_sleep — not the RPC name.
reader_sleeping=0
for _ in $(seq 1 80); do
  sleeping="$(sql_scalar "
    select exists (
      select 1
      from pg_stat_activity
      where wait_event = 'PgSleep'
        and query ilike '%pg_sleep%'
    );
  ")"
  sleeping="$(printf '%s' "${sleeping}" | tr -d '[:space:]')"
  if [[ "${sleeping}" == "t" ]]; then
    reader_sleeping=1
    break
  fi
  sleep 0.1
done

if [[ "${reader_sleeping}" -ne 1 ]]; then
  echo "reader never entered pg_sleep while holding FOR SHARE" >&2
  cat "${reader_log}" >&2 || true
  exit 1
fi

psql_db >"${saver_log}" 2>&1 <<SQL &
begin;
select set_config('request.jwt.claim.sub', '${owner_id}', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '${owner_id}', 'role', 'authenticated')::text,
  true
);
select public.save_quote_draft(
  '${quote_id}'::uuid,
  '${org_id}'::uuid,
  ${quote_version},
  jsonb_build_object('title', 'Lock probe saved'),
  jsonb_build_array(
    jsonb_build_object(
      'description', 'After save',
      'quantity', 2,
      'unit_price_cents', 250,
      'tax_rate_percent', 0,
      'position', 0
    )
  )
);
commit;
SQL
saver_pid=$!

saver_waiting=0
for _ in $(seq 1 50); do
  waiting="$(sql_scalar "
    select exists (
      select 1
      from pg_stat_activity
      where query like '%save_quote_draft%'
        and wait_event_type = 'Lock'
    );
  ")"
  waiting="$(printf '%s' "${waiting}" | tr -d '[:space:]')"
  if [[ "${waiting}" == "t" ]]; then
    saver_waiting=1
    break
  fi
  sleep 0.1
done

if [[ "${saver_waiting}" -ne 1 ]]; then
  echo "save_quote_draft did not block behind held get_quote_document lock" >&2
  cat "${reader_log}" >&2 || true
  cat "${saver_log}" >&2 || true
  exit 1
fi

wait "${reader_pid}"
wait "${saver_pid}"
reader_pid=""
saver_pid=""

result="$(sql_scalar "
  select
    quotes.version::text || E'\t' ||
    quote_lines.description || E'\t' ||
    trunc(quote_lines.quantity)::bigint::text || E'\t' ||
    quote_lines.unit_price_cents::text
  from public.quotes
  join public.quote_lines on quote_lines.quote_id = quotes.id
  where quotes.id = '${quote_id}'::uuid;
")"
result="$(printf '%s' "${result}" | tr -d '\r')"

got_version="$(printf '%s' "${result}" | cut -f1)"
got_description="$(printf '%s' "${result}" | cut -f2)"
got_quantity="$(printf '%s' "${result}" | cut -f3)"
got_unit_price="$(printf '%s' "${result}" | cut -f4)"
expected_version="$((quote_version + 1))"

if [[ "${got_version}" != "${expected_version}" ]]; then
  echo "expected version ${expected_version} after save, got ${got_version}" >&2
  cat "${saver_log}" >&2 || true
  exit 1
fi

if [[ "${got_description}" != "After save" || "${got_quantity}" != "2" || "${got_unit_price}" != "250" ]]; then
  echo "expected coherent post-release lines, got: ${result}" >&2
  cat "${saver_log}" >&2 || true
  exit 1
fi

echo "ok - held get_quote_document FOR SHARE blocked save_quote_draft; post-release document is coherent"

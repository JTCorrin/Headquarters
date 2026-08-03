#!/usr/bin/env bash
# Prove GET /quotes?client_id= and GET /invoices?client_id= filters for the
# Client Money tab (payments?client_id= already covered elsewhere).
#
# Usage:
#   SUPABASE_URL=http://192.168.5.136:54321 \
#   SUPABASE_ANON_KEY=... \
#   API_BASE=http://192.168.5.136:54321/functions/v1/api-v1 \
#   ./scripts/client_money_staging_curl_proof.sh
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL is required}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"
API_BASE="${API_BASE:-${SUPABASE_URL}/functions/v1/api-v1}"
API_BASE="${API_BASE%/}"

EMAIL="${PROOF_EMAIL:-client-money-proof-$(date +%s)-$RANDOM@example.test}"
PASSWORD="${PROOF_PASSWORD:-ProofPass123!}"
SLUG="${PROOF_SLUG:-client-money-proof-$(date +%s)}"
DISPLAY_NAME="${PROOF_DISPLAY_NAME:-Client Money Curl Proof}"
DUE_ON="$(date -u -d '+30 days' +%Y-%m-%d 2>/dev/null || date -u -v+30d +%Y-%m-%d)"

log() { printf '[client-money-curl-proof] %s\n' "$*"; }
die() { printf '[client-money-curl-proof] FAIL: %s\n' "$*" >&2; exit 1; }

log "signup ${EMAIL}"
signup_json="$(
	curl -fsS --max-time 30 \
		-X POST "${SUPABASE_URL}/auth/v1/signup" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg email "$EMAIL" --arg password "$PASSWORD" --arg name "$DISPLAY_NAME" \
			'{email:$email, password:$password, data:{display_name:$name}}')"
)"
ACCESS_TOKEN="$(printf '%s' "$signup_json" | jq -r '.access_token // empty')"
if [[ -z "$ACCESS_TOKEN" || "$ACCESS_TOKEN" == null ]]; then
	token_json="$(
		curl -fsS --max-time 30 \
			-X POST "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
			-H "apikey: ${SUPABASE_ANON_KEY}" \
			-H 'content-type: application/json' \
			-d "$(jq -n --arg email "$EMAIL" --arg password "$PASSWORD" \
				'{email:$email, password:$password}')"
	)"
	ACCESS_TOKEN="$(printf '%s' "$token_json" | jq -r '.access_token // empty')"
fi
[[ -n "$ACCESS_TOKEN" && "$ACCESS_TOKEN" != null ]] || die "no access_token after signup/password grant"
log "got JWT"

log "POST organisations"
create_org="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/organisations" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg name "Client Money Proof Org ${SLUG}" --arg slug "$SLUG" \
			'{name:$name, slug:$slug, country_code:"GB", default_currency:"GBP", locale:"en-GB"}')"
)"
ORG_ID="$(printf '%s' "$create_org" | jq -r '.data.organisation.id // empty')"
[[ -n "$ORG_ID" ]] || die "org create failed: ${create_org}"
log "org ${ORG_ID}"

H=(-H "apikey: ${SUPABASE_ANON_KEY}" -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "X-Org-Id: ${ORG_ID}")

log "POST clients A + B"
create_a="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/clients" \
		"${H[@]}" \
		-H 'content-type: application/json' \
		-d '{"name":"Money Client A","status":"active"}'
)"
CLIENT_A="$(printf '%s' "$create_a" | jq -r '.data.id // empty')"
[[ -n "$CLIENT_A" ]] || die "client A create: ${create_a}"

create_b="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/clients" \
		"${H[@]}" \
		-H 'content-type: application/json' \
		-d '{"name":"Money Client B","status":"active"}'
)"
CLIENT_B="$(printf '%s' "$create_b" | jq -r '.data.id // empty')"
[[ -n "$CLIENT_B" ]] || die "client B create: ${create_b}"
log "clients ${CLIENT_A} / ${CLIENT_B}"

log "POST contact"
create_contact="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/contacts" \
		"${H[@]}" \
		-H 'content-type: application/json' \
		-d '{"display_name":"Money Contact","lifecycle_status":"active"}'
)"
CONTACT_ID="$(printf '%s' "$create_contact" | jq -r '.data.id // empty')"
[[ -n "$CONTACT_ID" ]] || die "contact create: ${create_contact}"

log "POST quote for A"
create_quote_a="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/quotes" \
		"${H[@]}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg c "$CLIENT_A" '{
			title: "Money Quote A",
			client_id: $c,
			currency: "GBP",
			lines: [{description: "Day", quantity: 1, unit_price_cents: 10000, tax_rate_percent: 0}]
		}')"
)"
QUOTE_A="$(printf '%s' "$create_quote_a" | jq -r '.data.id // empty')"
[[ -n "$QUOTE_A" ]] || die "quote A create: ${create_quote_a}"

log "POST quote for B"
create_quote_b="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/quotes" \
		"${H[@]}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg c "$CLIENT_B" '{
			title: "Money Quote B",
			client_id: $c,
			currency: "GBP",
			lines: [{description: "Day", quantity: 1, unit_price_cents: 20000, tax_rate_percent: 0}]
		}')"
)"
QUOTE_B="$(printf '%s' "$create_quote_b" | jq -r '.data.id // empty')"
[[ -n "$QUOTE_B" ]] || die "quote B create: ${create_quote_b}"

log "POST invoice for A"
create_inv_a="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/invoices" \
		"${H[@]}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg c "$CLIENT_A" --arg contact "$CONTACT_ID" --arg due "$DUE_ON" '{
			client_id: $c,
			contact_id: $contact,
			currency: "GBP",
			due_on: $due,
			lines: [{description: "Fee", quantity: 1, unit_price_cents: 30000, tax_rate_percent: 0}]
		}')"
)"
INV_A="$(printf '%s' "$create_inv_a" | jq -r '.data.id // empty')"
[[ -n "$INV_A" ]] || die "invoice A create: ${create_inv_a}"

log "POST invoice for B"
create_inv_b="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/invoices" \
		"${H[@]}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg c "$CLIENT_B" --arg contact "$CONTACT_ID" --arg due "$DUE_ON" '{
			client_id: $c,
			contact_id: $contact,
			currency: "GBP",
			due_on: $due,
			lines: [{description: "Fee", quantity: 1, unit_price_cents: 40000, tax_rate_percent: 0}]
		}')"
)"
INV_B="$(printf '%s' "$create_inv_b" | jq -r '.data.id // empty')"
[[ -n "$INV_B" ]] || die "invoice B create: ${create_inv_b}"

log "GET quotes?client_id=A"
list_quotes_a="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/quotes?client_id=${CLIENT_A}&limit=20" \
		"${H[@]}"
)"
QUOTE_A_HIT="$(printf '%s' "$list_quotes_a" | jq -r --arg id "$QUOTE_A" '[.data[]? | select(.id == $id)] | length')"
QUOTE_B_MISS="$(printf '%s' "$list_quotes_a" | jq -r --arg id "$QUOTE_B" '[.data[]? | select(.id == $id)] | length')"
QUOTE_LEN="$(printf '%s' "$list_quotes_a" | jq -r '.data | length')"
[[ "$QUOTE_A_HIT" == "1" && "$QUOTE_B_MISS" == "0" && "$QUOTE_LEN" == "1" ]] \
	|| die "quotes client_id filter: ${list_quotes_a}"

log "GET invoices?client_id=A"
list_inv_a="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/invoices?client_id=${CLIENT_A}&limit=20" \
		"${H[@]}"
)"
INV_A_HIT="$(printf '%s' "$list_inv_a" | jq -r --arg id "$INV_A" '[.data[]? | select(.id == $id)] | length')"
INV_B_MISS="$(printf '%s' "$list_inv_a" | jq -r --arg id "$INV_B" '[.data[]? | select(.id == $id)] | length')"
INV_LEN="$(printf '%s' "$list_inv_a" | jq -r '.data | length')"
[[ "$INV_A_HIT" == "1" && "$INV_B_MISS" == "0" && "$INV_LEN" == "1" ]] \
	|| die "invoices client_id filter: ${list_inv_a}"

log "GET quotes?client_id= invalid → 400"
bad_code="$(
	curl -sS --max-time 30 -o /tmp/client-money-bad.body -w '%{http_code}' \
		"${API_BASE}/api/v1/quotes?client_id=not-a-uuid" \
		"${H[@]}"
)"
[[ "$bad_code" == "400" ]] || die "expected 400 for bad client_id, got ${bad_code}: $(cat /tmp/client-money-bad.body)"

log "PASS client money staging curl proof"

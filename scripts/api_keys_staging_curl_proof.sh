#!/usr/bin/env bash
# Prove MCP-Keys-BE: JWT create/list → Bearer crm_key_ reads contacts → revoke → key 401.
#
# Usage:
#   SUPABASE_URL=http://192.168.5.136:54321 \
#   SUPABASE_ANON_KEY=... \
#   API_BASE=http://192.168.5.136:54321/functions/v1/api-v1 \
#   ./scripts/api_keys_staging_curl_proof.sh
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL is required}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"
API_BASE="${API_BASE:-${SUPABASE_URL}/functions/v1/api-v1}"
API_BASE="${API_BASE%/}"

EMAIL="${PROOF_EMAIL:-apikey-proof-$(date +%s)-$RANDOM@example.test}"
PASSWORD="${PROOF_PASSWORD:-ProofPass123!}"
SLUG="${PROOF_SLUG:-apikey-proof-$(date +%s)}"
DISPLAY_NAME="${PROOF_DISPLAY_NAME:-API Keys Curl Proof}"

log() { printf '[api-keys-curl-proof] %s\n' "$*"; }
die() { printf '[api-keys-curl-proof] FAIL: %s\n' "$*" >&2; exit 1; }

api_jwt() {
	local method="$1"
	local path="$2"
	shift 2
	curl -sS --max-time 45 -X "$method" "${API_BASE}${path}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		"$@"
}

api_key() {
	local method="$1"
	local path="$2"
	shift 2
	curl -sS --max-time 45 -X "$method" "${API_BASE}${path}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${CRM_KEY}" \
		-H 'content-type: application/json' \
		"$@"
}

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

log "POST organisations"
create_org="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/organisations" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg name "API Keys Proof Org ${SLUG}" --arg slug "$SLUG" \
			'{name:$name, slug:$slug, country_code:"GB", default_currency:"GBP", locale:"en-GB"}')"
)"
ORG_ID="$(printf '%s' "$create_org" | jq -r '.data.organisation.id // empty')"
[[ -n "$ORG_ID" ]] || die "org create failed: ${create_org}"

log "POST contact (JWT)"
contact_json="$(
	api_jwt POST /api/v1/contacts --data "$(jq -n \
		'{display_name:"API Key Probe Contact", first_name:"API", last_name:"Probe"}')"
)"
CONTACT_ID="$(printf '%s' "$contact_json" | jq -r '.data.id // empty')"
[[ -n "$CONTACT_ID" ]] || die "contact create failed: ${contact_json}"

log "POST /api/v1/api-keys (JWT owner)"
create_key="$(
	api_jwt POST /api/v1/api-keys --data "$(jq -n \
		'{name:"Curl proof key", role:"member"}')"
)"
KEY_ID="$(printf '%s' "$create_key" | jq -r '.data.id // empty')"
CRM_KEY="$(printf '%s' "$create_key" | jq -r '.data.secret // empty')"
PREFIX="$(printf '%s' "$create_key" | jq -r '.data.prefix // empty')"
[[ -n "$KEY_ID" && -n "$CRM_KEY" ]] || die "api key create failed: ${create_key}"
printf '%s' "$CRM_KEY" | grep -Eq '^crm_key_[0-9a-f]{32}$' \
	|| die "secret shape unexpected: ${CRM_KEY}"
log "created key ${KEY_ID} prefix=${PREFIX}"

log "GET /api/v1/api-keys (JWT list)"
list_json="$(api_jwt GET /api/v1/api-keys)"
printf '%s' "$list_json" | jq -e --arg id "$KEY_ID" \
	'(.data | type == "array") and (.data | map(.id) | index($id) != null)' >/dev/null \
	|| die "list missing key: ${list_json}"
printf '%s' "$list_json" | jq -e '[.. | objects | select(has("secret"))] | length == 0' >/dev/null \
	|| die "list leaked secret: ${list_json}"

log "GET /api/v1/contacts with Bearer crm_key_ (no X-Org-Id)"
key_list="$(api_key GET /api/v1/contacts)"
printf '%s' "$key_list" | jq -e --arg id "$CONTACT_ID" \
	'(.data | type == "array") and (.data | map(.id) | index($id) != null)' >/dev/null \
	|| die "API key could not list contacts: ${key_list}"

log "GET /api/v1/contacts with crm_key_ + matching X-Org-Id"
key_list2="$(
	curl -sS --max-time 45 -X GET "${API_BASE}/api/v1/contacts" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${CRM_KEY}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json'
)"
printf '%s' "$key_list2" | jq -e --arg id "$CONTACT_ID" \
	'(.data | map(.id) | index($id) != null)' >/dev/null \
	|| die "API key + X-Org-Id list failed: ${key_list2}"

log "DELETE /api/v1/api-keys/{id} (revoke)"
revoke_json="$(api_jwt DELETE "/api/v1/api-keys/${KEY_ID}")"
printf '%s' "$revoke_json" | jq -e '.data.revoked_at != null' >/dev/null \
	|| die "revoke failed: ${revoke_json}"

log "GET contacts with revoked key (expect 401)"
revoked_status="$(
	curl -sS --max-time 45 -o /tmp/api-keys-revoked.json -w '%{http_code}' \
		-X GET "${API_BASE}/api/v1/contacts" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${CRM_KEY}"
)"
[[ "$revoked_status" == "401" ]] || die "expected 401 after revoke, got ${revoked_status}: $(cat /tmp/api-keys-revoked.json)"

log "JWT still lists contacts after revoke"
jwt_list="$(api_jwt GET /api/v1/contacts)"
printf '%s' "$jwt_list" | jq -e --arg id "$CONTACT_ID" \
	'(.data | map(.id) | index($id) != null)' >/dev/null \
	|| die "JWT contacts broken after revoke: ${jwt_list}"

log "PASS api keys create/list/auth/revoke proof"

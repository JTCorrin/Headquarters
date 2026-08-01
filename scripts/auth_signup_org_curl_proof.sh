#!/usr/bin/env bash
# Prove email/password signup → JWT → list/create organisations against a live stack.
# Usage:
#   SUPABASE_URL=http://127.0.0.1:54321 \
#   SUPABASE_ANON_KEY=... \
#   API_BASE=http://127.0.0.1:54321/functions/v1/api-v1 \
#   ./scripts/auth_signup_org_curl_proof.sh
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL is required}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"
# Edge mount (legacy) or same-origin proxy — must expose /api/v1/*.
API_BASE="${API_BASE:-${SUPABASE_URL}/functions/v1/api-v1}"
API_BASE="${API_BASE%/}"

EMAIL="${PROOF_EMAIL:-proof-$(date +%s)-$RANDOM@example.test}"
PASSWORD="${PROOF_PASSWORD:-ProofPass123!}"
SLUG="${PROOF_SLUG:-proof-org-$(date +%s)}"
DISPLAY_NAME="${PROOF_DISPLAY_NAME:-Curl Proof}"

log() { printf '[auth-curl-proof] %s\n' "$*"; }

log "signup ${EMAIL}"
signup_json="$(
	curl -fsS --max-time 30 \
		-X POST "${SUPABASE_URL}/auth/v1/signup" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H 'content-type: application/json' \
		-d "$(jq -n \
			--arg email "$EMAIL" \
			--arg password "$PASSWORD" \
			--arg name "$DISPLAY_NAME" \
			'{email:$email, password:$password, data:{display_name:$name}}')"
)"

ACCESS_TOKEN="$(printf '%s' "$signup_json" | jq -r '.access_token // empty')"
if [[ -z "$ACCESS_TOKEN" || "$ACCESS_TOKEN" == null ]]; then
	# Some GoTrue builds return session nested; also try password grant if confirmations were on.
	log "signup response missing access_token; trying password grant"
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
test -n "$ACCESS_TOKEN"
USER_ID="$(printf '%s' "$ACCESS_TOKEN" | awk -F. '{print $2}' | tr '_-' '+/' | base64 -d 2>/dev/null | jq -r '.sub // empty' || true)"
log "got JWT (sub=${USER_ID:-unknown})"

log "GET ${API_BASE}/api/v1/organisations (expect empty list)"
list_json="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/organisations" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}"
)"
printf '%s' "$list_json" | jq -e '.data | type == "array"' >/dev/null
log "list ok ($(printf '%s' "$list_json" | jq '.data | length') orgs)"

log "POST ${API_BASE}/api/v1/organisations"
create_json="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/organisations" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H 'content-type: application/json' \
		-d "$(jq -n \
			--arg name "Proof Org ${SLUG}" \
			--arg slug "$SLUG" \
			'{name:$name, slug:$slug, country_code:"GB", default_currency:"GBP", locale:"en-GB"}')"
)"
ORG_ID="$(printf '%s' "$create_json" | jq -r '.data.organisation.id // empty')"
ROLE="$(printf '%s' "$create_json" | jq -r '.data.membership.role // empty')"
test -n "$ORG_ID"
test "$ROLE" = "owner"
log "created org ${ORG_ID} with owner membership"

log "GET organisations after create (expect >= 1)"
list2="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/organisations" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}"
)"
printf '%s' "$list2" | jq -e --arg id "$ORG_ID" '.data | map(.organisation.id) | index($id) != null' >/dev/null

log "PASS signup → JWT → GET/POST organisations"

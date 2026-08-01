#!/usr/bin/env bash
# Prove lead board reorder, currency fallback, contact↔client link, and
# tenancy-safe lead client_id against a live stack (JWT + X-Org-Id).
#
# Usage:
#   SUPABASE_URL=http://192.168.5.136:54321 \
#   SUPABASE_ANON_KEY=... \
#   API_BASE=http://192.168.5.136:54321/functions/v1/api-v1 \
#   ./scripts/lead_board_client_links_staging_curl_proof.sh
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL is required}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"
API_BASE="${API_BASE:-${SUPABASE_URL}/functions/v1/api-v1}"
API_BASE="${API_BASE%/}"

EMAIL="${PROOF_EMAIL:-lb-proof-$(date +%s)-$RANDOM@example.test}"
PASSWORD="${PROOF_PASSWORD:-ProofPass123!}"
SLUG="${PROOF_SLUG:-lb-proof-$(date +%s)}"
DISPLAY_NAME="${PROOF_DISPLAY_NAME:-Lead Board Curl Proof}"

log() { printf '[lb-curl-proof] %s\n' "$*"; }
die() { printf '[lb-curl-proof] FAIL: %s\n' "$*" >&2; exit 1; }

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
[[ -n "$ACCESS_TOKEN" ]] || die "no access_token after signup/password grant"

log "POST organisations (default_currency GBP)"
create_org="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/organisations" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H 'content-type: application/json' \
		-d "$(jq -n \
			--arg name "LB Proof Org ${SLUG}" \
			--arg slug "$SLUG" \
			'{name:$name, slug:$slug, country_code:"GB", default_currency:"GBP", locale:"en-GB"}')"
)"
ORG_ID="$(printf '%s' "$create_org" | jq -r '.data.organisation.id // empty')"
[[ -n "$ORG_ID" ]] || die "org create failed: ${create_org}"

log "POST client with default_currency USD"
create_client="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/clients" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n '{
			name: "USD Client Ltd",
			status: "active",
			default_currency: "USD"
		}')"
)"
CLIENT_ID="$(printf '%s' "$create_client" | jq -r '.data.id // empty')"
[[ -n "$CLIENT_ID" ]] || die "client create: ${create_client}"

log "POST lead with client_id, omit currency → expect USD"
create_lead="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/leads" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg cid "$CLIENT_ID" '{
			name: "Board Opportunity",
			stage: "new",
			value_cents: 10000,
			client_id: $cid,
			position: 1
		}')"
)"
LEAD_ID="$(printf '%s' "$create_lead" | jq -r '.data.id // empty')"
LEAD_VER="$(printf '%s' "$create_lead" | jq -r '.data.version // empty')"
LEAD_CURRENCY="$(printf '%s' "$create_lead" | jq -r '.data.currency // empty')"
LEAD_CLIENT="$(printf '%s' "$create_lead" | jq -r '.data.client_id // empty')"
[[ "$LEAD_CURRENCY" == "USD" && "$LEAD_CLIENT" == "$CLIENT_ID" && -n "$LEAD_ID" ]] \
	|| die "currency fallback / client_id: ${create_lead}"
log "lead ${LEAD_ID} currency=${LEAD_CURRENCY} client=${LEAD_CLIENT}"

log "PATCH lead stage+position (board move)"
patch_lead="$(
	curl -fsS --max-time 30 \
		-X PATCH "${API_BASE}/api/v1/leads/${LEAD_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${LEAD_VER}\"" \
		-H 'content-type: application/json' \
		-d "$(jq -n '{stage: "proposal", position: 3.5}')"
)"
LEAD_VER="$(printf '%s' "$patch_lead" | jq -r '.data.version // empty')"
STAGE="$(printf '%s' "$patch_lead" | jq -r '.data.stage // empty')"
POSITION="$(printf '%s' "$patch_lead" | jq -r '.data.position // empty')"
[[ "$STAGE" == "proposal" && "$POSITION" == "3.5" && -n "$LEAD_VER" ]] \
	|| die "stage+position patch: ${patch_lead}"
log "board move → stage=${STAGE} position=${POSITION}"

log "GET lead asserts persisted board fields"
get_lead="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/leads/${LEAD_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
printf '%s' "$get_lead" | jq -e \
	--arg stage "$STAGE" \
	'.data.stage == $stage and (.data.position | tonumber) == 3.5' >/dev/null \
	|| die "lead get after board move: ${get_lead}"

log "POST contact with client_id → primary client_contacts"
create_contact="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/contacts" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg cid "$CLIENT_ID" '{
			display_name: "Board Contact",
			primary_email: "board-contact@example.test",
			client_id: $cid
		}')"
)"
CONTACT_ID="$(printf '%s' "$create_contact" | jq -r '.data.id // empty')"
CONTACT_CLIENT="$(printf '%s' "$create_contact" | jq -r '.data.client_id // empty')"
CONTACT_VER="$(printf '%s' "$create_contact" | jq -r '.data.version // empty')"
[[ "$CONTACT_CLIENT" == "$CLIENT_ID" && -n "$CONTACT_ID" ]] \
	|| die "contact client_id link: ${create_contact}"

log "GET contact returns linked client_id"
get_contact="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/contacts/${CONTACT_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
printf '%s' "$get_contact" | jq -e --arg cid "$CLIENT_ID" '.data.client_id == $cid' >/dev/null \
	|| die "contact get client_id: ${get_contact}"

log "PATCH contact clear client_id"
patch_contact="$(
	curl -fsS --max-time 30 \
		-X PATCH "${API_BASE}/api/v1/contacts/${CONTACT_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${CONTACT_VER}\"" \
		-H 'content-type: application/json' \
		-d "$(jq -n '{client_id: null}')"
)"
[[ "$(printf '%s' "$patch_contact" | jq -r '.data.client_id')" == "null" ]] \
	|| die "expected null client_id after clear: ${patch_contact}"

log "cross-org lead client_id denied"
# Second org + client owned by same user
create_org2="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/organisations" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H 'content-type: application/json' \
		-d "$(jq -n \
			--arg name "LB Other Org ${SLUG}" \
			--arg slug "${SLUG}-other" \
			'{name:$name, slug:$slug, country_code:"GB", default_currency:"EUR", locale:"en-GB"}')"
)"
ORG2_ID="$(printf '%s' "$create_org2" | jq -r '.data.organisation.id // empty')"
[[ -n "$ORG2_ID" ]] || die "org2 create: ${create_org2}"

create_foreign_client="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/clients" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG2_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n '{name: "Foreign Client", status: "active"}')"
)"
FOREIGN_CLIENT="$(printf '%s' "$create_foreign_client" | jq -r '.data.id // empty')"
[[ -n "$FOREIGN_CLIENT" ]] || die "foreign client: ${create_foreign_client}"

cross_code="$(
	curl -sS --max-time 30 -o /tmp/lb-cross.body -w '%{http_code}' \
		-X POST "${API_BASE}/api/v1/leads" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg cid "$FOREIGN_CLIENT" '{
			name: "Cross Org Lead",
			client_id: $cid
		}')"
)"
[[ "$cross_code" == "422" || "$cross_code" == "403" ]] \
	|| die "expected 422/403 for cross-org client_id, got ${cross_code}: $(cat /tmp/lb-cross.body)"
log "cross-org denial HTTP ${cross_code}"

log "PASS lead board reorder + currency fallback + contact client link + tenancy"

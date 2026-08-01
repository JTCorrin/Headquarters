#!/usr/bin/env bash
# Prove leads + clients CRUD against a live stack (JWT + X-Org-Id).
# Mirrors scripts/contacts_quotes_staging_curl_proof.sh bootstrap.
#
# Usage:
#   SUPABASE_URL=http://192.168.5.136:54321 \
#   SUPABASE_ANON_KEY=... \
#   API_BASE=http://192.168.5.136:54321/functions/v1/api-v1 \
#   ./scripts/leads_clients_staging_curl_proof.sh
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL is required}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"
API_BASE="${API_BASE:-${SUPABASE_URL}/functions/v1/api-v1}"
API_BASE="${API_BASE%/}"

EMAIL="${PROOF_EMAIL:-lc-proof-$(date +%s)-$RANDOM@example.test}"
PASSWORD="${PROOF_PASSWORD:-ProofPass123!}"
SLUG="${PROOF_SLUG:-lc-proof-$(date +%s)}"
DISPLAY_NAME="${PROOF_DISPLAY_NAME:-LC Curl Proof}"

log() { printf '[lc-curl-proof] %s\n' "$*"; }
die() { printf '[lc-curl-proof] FAIL: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Bootstrap: signup → JWT → create organisation
# ---------------------------------------------------------------------------
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
[[ -n "$ACCESS_TOKEN" ]] || die "no access_token after signup/password grant"
log "got JWT"

log "POST organisations"
create_org="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/organisations" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H 'content-type: application/json' \
		-d "$(jq -n \
			--arg name "LC Proof Org ${SLUG}" \
			--arg slug "$SLUG" \
			'{name:$name, slug:$slug, country_code:"GB", default_currency:"GBP", locale:"en-GB"}')"
)"
ORG_ID="$(printf '%s' "$create_org" | jq -r '.data.organisation.id // empty')"
[[ -n "$ORG_ID" ]] || die "org create failed: ${create_org}"
log "org ${ORG_ID}"

# ---------------------------------------------------------------------------
# Leads CRUD
# ---------------------------------------------------------------------------
log "GET leads (expect empty)"
list_leads="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/leads" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
printf '%s' "$list_leads" | jq -e '.data | type == "array"' >/dev/null \
	|| die "leads list shape: ${list_leads}"
[[ "$(printf '%s' "$list_leads" | jq '.data | length')" -eq 0 ]] \
	|| die "expected empty leads list"

log "POST lead"
create_lead="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/leads" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n '{
			name: "Acme Opportunity",
			company_name: "Acme Corp",
			stage: "qualified",
			value_cents: 250000,
			currency: "GBP",
			source: "curl-proof"
		}')"
)"
LEAD_ID="$(printf '%s' "$create_lead" | jq -r '.data.id // empty')"
LEAD_VER="$(printf '%s' "$create_lead" | jq -r '.data.version // empty')"
LEAD_STAGE="$(printf '%s' "$create_lead" | jq -r '.data.stage // empty')"
[[ -n "$LEAD_ID" && -n "$LEAD_VER" && "$LEAD_STAGE" == "qualified" ]] \
	|| die "lead create: ${create_lead}"
log "lead ${LEAD_ID} v${LEAD_VER}"

log "GET lead"
get_lead="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/leads/${LEAD_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
printf '%s' "$get_lead" | jq -e --arg id "$LEAD_ID" '.data.id == $id' >/dev/null \
	|| die "lead get: ${get_lead}"

log "PATCH lead (If-Match)"
patch_lead="$(
	curl -fsS --max-time 30 \
		-X PATCH "${API_BASE}/api/v1/leads/${LEAD_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${LEAD_VER}\"" \
		-H 'content-type: application/json' \
		-d "$(jq -n '{stage: "proposal", notes: "Sent proposal pack"}')"
)"
LEAD_VER="$(printf '%s' "$patch_lead" | jq -r '.data.version // empty')"
STAGE="$(printf '%s' "$patch_lead" | jq -r '.data.stage // empty')"
NOTES="$(printf '%s' "$patch_lead" | jq -r '.data.notes // empty')"
[[ "$STAGE" == "proposal" && "$NOTES" == "Sent proposal pack" && -n "$LEAD_VER" ]] \
	|| die "lead patch: ${patch_lead}"
log "lead patched → v${LEAD_VER}"

log "GET leads (expect 1)"
list_leads2="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/leads" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
printf '%s' "$list_leads2" | jq -e --arg id "$LEAD_ID" \
	'.data | map(.id) | index($id) != null' >/dev/null \
	|| die "lead missing from list: ${list_leads2}"

log "DELETE lead (soft)"
del_lead_code="$(
	curl -sS --max-time 30 -o /tmp/lc-del-lead.body -w '%{http_code}' \
		-X DELETE "${API_BASE}/api/v1/leads/${LEAD_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${LEAD_VER}\""
)"
[[ "$del_lead_code" == "204" ]] || die "lead delete HTTP ${del_lead_code}: $(cat /tmp/lc-del-lead.body)"

get_lead_gone="$(
	curl -sS --max-time 30 -o /tmp/lc-get-lead-gone.body -w '%{http_code}' \
		"${API_BASE}/api/v1/leads/${LEAD_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
[[ "$get_lead_gone" == "404" ]] || die "expected 404 after lead delete, got ${get_lead_gone}"
log "leads CRUD PASS"

# ---------------------------------------------------------------------------
# Clients CRUD
# ---------------------------------------------------------------------------
log "GET clients (expect empty)"
list_clients="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/clients" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
printf '%s' "$list_clients" | jq -e '.data | type == "array"' >/dev/null \
	|| die "clients list shape: ${list_clients}"
[[ "$(printf '%s' "$list_clients" | jq '.data | length')" -eq 0 ]] \
	|| die "expected empty clients list"

log "POST client"
create_client="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/clients" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n '{
			name: "Proof Client Ltd",
			status: "prospect",
			industry: "Manufacturing",
			primary_email: "billing@proof-client.test"
		}')"
)"
CLIENT_ID="$(printf '%s' "$create_client" | jq -r '.data.id // empty')"
CLIENT_VER="$(printf '%s' "$create_client" | jq -r '.data.version // empty')"
CLIENT_STATUS="$(printf '%s' "$create_client" | jq -r '.data.status // empty')"
[[ -n "$CLIENT_ID" && -n "$CLIENT_VER" && "$CLIENT_STATUS" == "prospect" ]] \
	|| die "client create: ${create_client}"
log "client ${CLIENT_ID} v${CLIENT_VER}"

log "GET client"
get_client="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/clients/${CLIENT_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
printf '%s' "$get_client" | jq -e --arg id "$CLIENT_ID" '.data.id == $id' >/dev/null \
	|| die "client get: ${get_client}"

log "PATCH client (If-Match)"
patch_client="$(
	curl -fsS --max-time 30 \
		-X PATCH "${API_BASE}/api/v1/clients/${CLIENT_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${CLIENT_VER}\"" \
		-H 'content-type: application/json' \
		-d "$(jq -n '{status: "active", payment_terms_days: 30}')"
)"
CLIENT_VER="$(printf '%s' "$patch_client" | jq -r '.data.version // empty')"
STATUS="$(printf '%s' "$patch_client" | jq -r '.data.status // empty')"
TERMS="$(printf '%s' "$patch_client" | jq -r '.data.payment_terms_days // empty')"
[[ "$STATUS" == "active" && "$TERMS" == "30" && -n "$CLIENT_VER" ]] \
	|| die "client patch: ${patch_client}"
log "client patched → v${CLIENT_VER}"

log "GET clients (expect 1)"
list_clients2="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/clients" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
printf '%s' "$list_clients2" | jq -e --arg id "$CLIENT_ID" \
	'.data | map(.id) | index($id) != null' >/dev/null \
	|| die "client missing from list: ${list_clients2}"

log "DELETE client (soft)"
del_client_code="$(
	curl -sS --max-time 30 -o /tmp/lc-del-client.body -w '%{http_code}' \
		-X DELETE "${API_BASE}/api/v1/clients/${CLIENT_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${CLIENT_VER}\""
)"
[[ "$del_client_code" == "204" ]] || die "client delete HTTP ${del_client_code}: $(cat /tmp/lc-del-client.body)"

get_client_gone="$(
	curl -sS --max-time 30 -o /tmp/lc-get-client-gone.body -w '%{http_code}' \
		"${API_BASE}/api/v1/clients/${CLIENT_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
[[ "$get_client_gone" == "404" ]] || die "expected 404 after client delete, got ${get_client_gone}"
log "clients CRUD PASS"

log "PASS leads CRUD + clients CRUD"

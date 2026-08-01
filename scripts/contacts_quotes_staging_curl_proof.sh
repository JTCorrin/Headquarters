#!/usr/bin/env bash
# Prove contacts CRUD + quotes draft list/create/get/patch/delete against a live stack.
# Requires JWT auth + X-Org-Id. Mirrors scripts/auth_signup_org_curl_proof.sh bootstrap.
#
# Usage:
#   SUPABASE_URL=http://192.168.5.136:54321 \
#   SUPABASE_ANON_KEY=... \
#   API_BASE=http://192.168.5.136:54321/functions/v1/api-v1 \
#   ./scripts/contacts_quotes_staging_curl_proof.sh
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL is required}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"
API_BASE="${API_BASE:-${SUPABASE_URL}/functions/v1/api-v1}"
API_BASE="${API_BASE%/}"

EMAIL="${PROOF_EMAIL:-cq-proof-$(date +%s)-$RANDOM@example.test}"
PASSWORD="${PROOF_PASSWORD:-ProofPass123!}"
SLUG="${PROOF_SLUG:-cq-proof-$(date +%s)}"
DISPLAY_NAME="${PROOF_DISPLAY_NAME:-CQ Curl Proof}"

log() { printf '[cq-curl-proof] %s\n' "$*"; }
die() { printf '[cq-curl-proof] FAIL: %s\n' "$*" >&2; exit 1; }

auth_hdrs() {
	printf '%s\n' \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}"
}

org_hdrs() {
	auth_hdrs
	printf '%s\n' -H "X-Org-Id: ${ORG_ID}"
}

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
			--arg name "CQ Proof Org ${SLUG}" \
			--arg slug "$SLUG" \
			'{name:$name, slug:$slug, country_code:"GB", default_currency:"GBP", locale:"en-GB"}')"
)"
ORG_ID="$(printf '%s' "$create_org" | jq -r '.data.organisation.id // empty')"
[[ -n "$ORG_ID" ]] || die "org create failed: ${create_org}"
log "org ${ORG_ID}"

# ---------------------------------------------------------------------------
# Contacts CRUD
# ---------------------------------------------------------------------------
log "GET contacts (expect empty)"
list_contacts="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/contacts" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
printf '%s' "$list_contacts" | jq -e '.data | type == "array"' >/dev/null \
	|| die "contacts list shape: ${list_contacts}"
[[ "$(printf '%s' "$list_contacts" | jq '.data | length')" -eq 0 ]] \
	|| die "expected empty contacts list"

log "POST contact"
create_contact="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/contacts" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n '{
			display_name: "Ada Lovelace",
			first_name: "Ada",
			last_name: "Lovelace",
			primary_email: "ada@example.test",
			lifecycle_status: "active",
			company_name: "Analytical Engines"
		}')"
)"
CONTACT_ID="$(printf '%s' "$create_contact" | jq -r '.data.id // empty')"
CONTACT_VER="$(printf '%s' "$create_contact" | jq -r '.data.version // empty')"
[[ -n "$CONTACT_ID" && -n "$CONTACT_VER" ]] || die "contact create: ${create_contact}"
log "contact ${CONTACT_ID} v${CONTACT_VER}"

log "GET contact"
get_contact="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/contacts/${CONTACT_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
printf '%s' "$get_contact" | jq -e --arg id "$CONTACT_ID" '.data.id == $id' >/dev/null \
	|| die "contact get: ${get_contact}"

log "PATCH contact (If-Match)"
patch_contact="$(
	curl -fsS --max-time 30 \
		-X PATCH "${API_BASE}/api/v1/contacts/${CONTACT_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${CONTACT_VER}\"" \
		-H 'content-type: application/json' \
		-d "$(jq -n '{job_title: "Mathematician", lifecycle_status: "inactive"}')"
)"
CONTACT_VER="$(printf '%s' "$patch_contact" | jq -r '.data.version // empty')"
JOB="$(printf '%s' "$patch_contact" | jq -r '.data.job_title // empty')"
LIFE="$(printf '%s' "$patch_contact" | jq -r '.data.lifecycle_status // empty')"
[[ "$JOB" == "Mathematician" && "$LIFE" == "inactive" && -n "$CONTACT_VER" ]] \
	|| die "contact patch: ${patch_contact}"
log "contact patched → v${CONTACT_VER}"

log "GET contacts (expect 1)"
list_contacts2="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/contacts" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
printf '%s' "$list_contacts2" | jq -e --arg id "$CONTACT_ID" \
	'.data | map(.id) | index($id) != null' >/dev/null \
	|| die "contact missing from list: ${list_contacts2}"

log "DELETE contact (soft)"
del_code="$(
	curl -sS --max-time 30 -o /tmp/cq-del-contact.body -w '%{http_code}' \
		-X DELETE "${API_BASE}/api/v1/contacts/${CONTACT_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${CONTACT_VER}\""
)"
[[ "$del_code" == "204" ]] || die "contact delete HTTP ${del_code}: $(cat /tmp/cq-del-contact.body)"

get_gone_code="$(
	curl -sS --max-time 30 -o /tmp/cq-get-gone.body -w '%{http_code}' \
		"${API_BASE}/api/v1/contacts/${CONTACT_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
[[ "$get_gone_code" == "404" ]] || die "expected 404 after delete, got ${get_gone_code}"
log "contacts CRUD PASS"

# ---------------------------------------------------------------------------
# Quotes draft CRUD (needs client_id or lead_id)
# ---------------------------------------------------------------------------
log "POST client (quote party)"
create_client="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/clients" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n '{name: "Proof Client Ltd", status: "prospect"}')"
)"
CLIENT_ID="$(printf '%s' "$create_client" | jq -r '.data.id // empty')"
[[ -n "$CLIENT_ID" ]] || die "client create: ${create_client}"
log "client ${CLIENT_ID}"

log "GET quotes (expect empty / draft filter ok)"
list_quotes="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/quotes?status=draft" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
printf '%s' "$list_quotes" | jq -e '.data | type == "array"' >/dev/null \
	|| die "quotes list shape: ${list_quotes}"

log "POST quote draft"
create_quote="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/quotes" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg client "$CLIENT_ID" '{
			title: "Proof Quote",
			client_id: $client,
			currency: "GBP",
			lines: [
				{
					description: "Consulting day",
					quantity: 2,
					unit_price_cents: 50000,
					tax_rate_percent: 20
				}
			]
		}')"
)"
QUOTE_ID="$(printf '%s' "$create_quote" | jq -r '.data.id // empty')"
QUOTE_VER="$(printf '%s' "$create_quote" | jq -r '.data.version // empty')"
QUOTE_STATUS="$(printf '%s' "$create_quote" | jq -r '.data.status // empty')"
LINES="$(printf '%s' "$create_quote" | jq -r '.data.lines | length')"
[[ -n "$QUOTE_ID" && "$QUOTE_STATUS" == "draft" && "$LINES" == "1" ]] \
	|| die "quote create: ${create_quote}"
log "quote ${QUOTE_ID} v${QUOTE_VER} status=${QUOTE_STATUS}"

log "GET quote"
get_quote="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/quotes/${QUOTE_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
printf '%s' "$get_quote" | jq -e --arg id "$QUOTE_ID" \
	'.data.id == $id and (.data.lines | length) == 1' >/dev/null \
	|| die "quote get: ${get_quote}"

log "PATCH quote draft (If-Match + line replace)"
patch_quote="$(
	curl -fsS --max-time 30 \
		-X PATCH "${API_BASE}/api/v1/quotes/${QUOTE_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${QUOTE_VER}\"" \
		-H 'content-type: application/json' \
		-d "$(jq -n '{
			title: "Proof Quote Revised",
			notes: "Updated by curl proof",
			lines: [
				{
					description: "Consulting half-day",
					quantity: 1,
					unit_price_cents: 25000,
					tax_rate_percent: 20
				},
				{
					description: "Expenses",
					quantity: 1,
					unit_price_cents: 1500,
					tax_rate_percent: 0
				}
			]
		}')"
)"
QUOTE_VER="$(printf '%s' "$patch_quote" | jq -r '.data.version // empty')"
TITLE="$(printf '%s' "$patch_quote" | jq -r '.data.title // empty')"
LINES2="$(printf '%s' "$patch_quote" | jq -r '.data.lines | length')"
[[ "$TITLE" == "Proof Quote Revised" && "$LINES2" == "2" && -n "$QUOTE_VER" ]] \
	|| die "quote patch: ${patch_quote}"
log "quote patched → v${QUOTE_VER}"

log "GET quotes list includes draft"
list_quotes2="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/quotes?status=draft" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
printf '%s' "$list_quotes2" | jq -e --arg id "$QUOTE_ID" \
	'.data | map(.id) | index($id) != null' >/dev/null \
	|| die "quote missing from list: ${list_quotes2}"

log "DELETE quote draft (soft)"
del_q_code="$(
	curl -sS --max-time 30 -o /tmp/cq-del-quote.body -w '%{http_code}' \
		-X DELETE "${API_BASE}/api/v1/quotes/${QUOTE_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${QUOTE_VER}\""
)"
[[ "$del_q_code" == "204" ]] || die "quote delete HTTP ${del_q_code}: $(cat /tmp/cq-del-quote.body)"

get_q_gone="$(
	curl -sS --max-time 30 -o /tmp/cq-get-q-gone.body -w '%{http_code}' \
		"${API_BASE}/api/v1/quotes/${QUOTE_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
[[ "$get_q_gone" == "404" ]] || die "expected 404 after quote delete, got ${get_q_gone}: $(cat /tmp/cq-get-q-gone.body)"
log "quotes draft CRUD PASS"

log "PASS contacts CRUD + quotes draft list/create/get/patch/delete"

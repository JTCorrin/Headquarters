#!/usr/bin/env bash
# Prove multi-contact recipients on quote + invoice drafts against a live stack.
#
# Usage:
#   SUPABASE_URL=http://192.168.5.136:54321 \
#   SUPABASE_ANON_KEY=... \
#   API_BASE=http://192.168.5.136:54321/functions/v1/api-v1 \
#   ./scripts/multi_contact_billing_staging_curl_proof.sh
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL is required}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"
API_BASE="${API_BASE:-${SUPABASE_URL}/functions/v1/api-v1}"
API_BASE="${API_BASE%/}"

EMAIL="${PROOF_EMAIL:-mcr-proof-$(date +%s)-$RANDOM@example.test}"
PASSWORD="${PROOF_PASSWORD:-ProofPass123!}"
SLUG="${PROOF_SLUG:-mcr-proof-$(date +%s)}"
DISPLAY_NAME="${PROOF_DISPLAY_NAME:-Multi Contact Curl Proof}"

log() { printf '[mcr-curl-proof] %s\n' "$*"; }
die() { printf '[mcr-curl-proof] FAIL: %s\n' "$*" >&2; exit 1; }

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
[[ -n "$ACCESS_TOKEN" ]] || die "no access_token"
log "got JWT"

create_org="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/organisations" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H 'content-type: application/json' \
		-d "$(jq -n \
			--arg name "MCR Proof Org ${SLUG}" \
			--arg slug "$SLUG" \
			'{name:$name, slug:$slug, country_code:"GB", default_currency:"GBP", locale:"en-GB"}')"
)"
ORG_ID="$(printf '%s' "$create_org" | jq -r '.data.organisation.id // empty')"
[[ -n "$ORG_ID" ]] || die "org create failed: ${create_org}"

auth=(-H "apikey: ${SUPABASE_ANON_KEY}" -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "X-Org-Id: ${ORG_ID}")

CLIENT_ID="$(
	curl -fsS --max-time 30 -X POST "${API_BASE}/api/v1/clients" \
		"${auth[@]}" -H 'content-type: application/json' \
		-d '{"name":"MCR Client","status":"active"}' | jq -r '.data.id // empty'
)"
[[ -n "$CLIENT_ID" ]] || die "client create failed"

CONTACT_A="$(
	curl -fsS --max-time 30 -X POST "${API_BASE}/api/v1/contacts" \
		"${auth[@]}" -H 'content-type: application/json' \
		-d '{"display_name":"Ada Billing","primary_email":"ada-mcr@example.test","lifecycle_status":"active"}' \
		| jq -r '.data.id // empty'
)"
CONTACT_B="$(
	curl -fsS --max-time 30 -X POST "${API_BASE}/api/v1/contacts" \
		"${auth[@]}" -H 'content-type: application/json' \
		-d '{"display_name":"Bob Other","primary_email":"bob-mcr@example.test","lifecycle_status":"active"}' \
		| jq -r '.data.id // empty'
)"
[[ -n "$CONTACT_A" && -n "$CONTACT_B" ]] || die "contact create failed"

log "POST quote with two recipients"
quote_json="$(
	curl -fsS --max-time 30 -X POST "${API_BASE}/api/v1/quotes" \
		"${auth[@]}" -H 'content-type: application/json' \
		-d "$(jq -n \
			--arg client "$CLIENT_ID" \
			--arg a "$CONTACT_A" \
			--arg b "$CONTACT_B" \
			'{
				title: "MCR Proof Quote",
				client_id: $client,
				currency: "GBP",
				recipients: [
					{contact_id: $a, is_billing: true},
					{contact_id: $b, is_billing: false}
				],
				lines: []
			}')"
)"
QUOTE_ID="$(printf '%s' "$quote_json" | jq -r '.data.id // empty')"
QUOTE_CONTACT="$(printf '%s' "$quote_json" | jq -r '.data.contact_id // empty')"
QUOTE_RECIPIENTS="$(printf '%s' "$quote_json" | jq -r '.data.recipients | length')"
[[ "$QUOTE_ID" != "" ]] || die "quote create: ${quote_json}"
[[ "$QUOTE_CONTACT" == "$CONTACT_A" ]] || die "quote contact_id denorm expected Ada, got ${QUOTE_CONTACT}"
[[ "$QUOTE_RECIPIENTS" == "2" ]] || die "quote recipients length expected 2, got ${QUOTE_RECIPIENTS}"
log "quote ${QUOTE_ID} recipients=2 contact_id=Ada"

log "POST invoice with same recipients"
invoice_json="$(
	curl -fsS --max-time 30 -X POST "${API_BASE}/api/v1/invoices" \
		"${auth[@]}" -H 'content-type: application/json' \
		-d "$(jq -n \
			--arg client "$CLIENT_ID" \
			--arg a "$CONTACT_A" \
			--arg b "$CONTACT_B" \
			'{
				client_id: $client,
				currency: "GBP",
				recipients: [
					{contact_id: $a, is_billing: true},
					{contact_id: $b}
				],
				lines: [
					{description: "Proof line", quantity: 1, unit_price_cents: 1000, tax_rate_percent: 0}
				]
			}')"
)"
INV_ID="$(printf '%s' "$invoice_json" | jq -r '.data.id // empty')"
INV_CONTACT="$(printf '%s' "$invoice_json" | jq -r '.data.contact_id // empty')"
INV_RECIPIENTS="$(printf '%s' "$invoice_json" | jq -r '.data.recipients | length')"
[[ "$INV_ID" != "" ]] || die "invoice create: ${invoice_json}"
[[ "$INV_CONTACT" == "$CONTACT_A" ]] || die "invoice contact_id denorm expected Ada"
[[ "$INV_RECIPIENTS" == "2" ]] || die "invoice recipients length expected 2"
log "invoice ${INV_ID} recipients=2 contact_id=Ada"

log "PASS multi-contact billing recipients curl proof"

#!/usr/bin/env bash
# Prove products CRUD against a live stack (JWT + X-Org-Id).
# Mirrors scripts/leads_clients_staging_curl_proof.sh bootstrap.
# Category/tax-rate are optional on create — not required for this proof.
#
# Usage:
#   SUPABASE_URL=http://192.168.5.136:54321 \
#   SUPABASE_ANON_KEY=... \
#   API_BASE=http://192.168.5.136:54321/functions/v1/api-v1 \
#   ./scripts/products_staging_curl_proof.sh
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL is required}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"
API_BASE="${API_BASE:-${SUPABASE_URL}/functions/v1/api-v1}"
API_BASE="${API_BASE%/}"

EMAIL="${PROOF_EMAIL:-prod-proof-$(date +%s)-$RANDOM@example.test}"
PASSWORD="${PROOF_PASSWORD:-ProofPass123!}"
SLUG="${PROOF_SLUG:-prod-proof-$(date +%s)}"
DISPLAY_NAME="${PROOF_DISPLAY_NAME:-Products Curl Proof}"
SKU_SUFFIX="${RANDOM}$(date +%s | tail -c 5)"

log() { printf '[prod-curl-proof] %s\n' "$*"; }
die() { printf '[prod-curl-proof] FAIL: %s\n' "$*" >&2; exit 1; }

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
			--arg name "Prod Proof Org ${SLUG}" \
			--arg slug "$SLUG" \
			'{name:$name, slug:$slug, country_code:"GB", default_currency:"GBP", locale:"en-GB"}')"
)"
ORG_ID="$(printf '%s' "$create_org" | jq -r '.data.organisation.id // empty')"
[[ -n "$ORG_ID" ]] || die "org create failed: ${create_org}"
log "org ${ORG_ID}"

# ---------------------------------------------------------------------------
# Products CRUD
# ---------------------------------------------------------------------------
log "GET products (expect empty)"
list_products="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/products" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
printf '%s' "$list_products" | jq -e '.data | type == "array"' >/dev/null \
	|| die "products list shape: ${list_products}"
[[ "$(printf '%s' "$list_products" | jq '.data | length')" -eq 0 ]] \
	|| die "expected empty products list"

log "POST product"
create_product="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/products" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg sku "PROOF-${SKU_SUFFIX}" '{
			sku: $sku,
			name: "Proof Widget",
			product_type: "product",
			unit_price_cents: 2500,
			currency: "GBP",
			description: "Created by products staging curl proof"
		}')"
)"
PRODUCT_ID="$(printf '%s' "$create_product" | jq -r '.data.id // empty')"
PRODUCT_VER="$(printf '%s' "$create_product" | jq -r '.data.version // empty')"
PRODUCT_TYPE="$(printf '%s' "$create_product" | jq -r '.data.product_type // empty')"
[[ -n "$PRODUCT_ID" && -n "$PRODUCT_VER" && "$PRODUCT_TYPE" == "product" ]] \
	|| die "product create: ${create_product}"
log "product ${PRODUCT_ID} v${PRODUCT_VER}"

log "GET product"
get_product="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/products/${PRODUCT_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
printf '%s' "$get_product" | jq -e --arg id "$PRODUCT_ID" '.data.id == $id' >/dev/null \
	|| die "product get: ${get_product}"

log "PATCH product (If-Match)"
patch_product="$(
	curl -fsS --max-time 30 \
		-X PATCH "${API_BASE}/api/v1/products/${PRODUCT_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${PRODUCT_VER}\"" \
		-H 'content-type: application/json' \
		-d "$(jq -n '{name: "Proof Widget Pro", unit_price_cents: 3000}')"
)"
PRODUCT_VER="$(printf '%s' "$patch_product" | jq -r '.data.version // empty')"
NAME="$(printf '%s' "$patch_product" | jq -r '.data.name // empty')"
PRICE="$(printf '%s' "$patch_product" | jq -r '.data.unit_price_cents // empty')"
[[ "$NAME" == "Proof Widget Pro" && "$PRICE" == "3000" && -n "$PRODUCT_VER" ]] \
	|| die "product patch: ${patch_product}"
log "product patched → v${PRODUCT_VER}"

log "GET products (expect 1)"
list_products2="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/products" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
printf '%s' "$list_products2" | jq -e --arg id "$PRODUCT_ID" \
	'.data | map(.id) | index($id) != null' >/dev/null \
	|| die "product missing from list: ${list_products2}"

log "DELETE product (soft)"
del_code="$(
	curl -sS --max-time 30 -o /tmp/prod-del.body -w '%{http_code}' \
		-X DELETE "${API_BASE}/api/v1/products/${PRODUCT_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${PRODUCT_VER}\""
)"
[[ "$del_code" == "204" ]] || die "product delete HTTP ${del_code}: $(cat /tmp/prod-del.body)"

get_gone="$(
	curl -sS --max-time 30 -o /tmp/prod-get-gone.body -w '%{http_code}' \
		"${API_BASE}/api/v1/products/${PRODUCT_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
[[ "$get_gone" == "404" ]] || die "expected 404 after product delete, got ${get_gone}"
log "products CRUD PASS"

log "PASS products list/create/get/patch/delete"

#!/usr/bin/env bash
# Prove Joe's product → quote → accept → invoice path against a live stack:
#   create product → quote line with product_id → accept → POST /invoices/from-quote
# Asserts line product_id + SKU/price/tax snapshots survive conversion (and live
# product mutation after quote create does not leak into the invoice).
#
# Usage:
#   SUPABASE_URL=http://192.168.5.136:54321 \
#   SUPABASE_ANON_KEY=... \
#   API_BASE=http://192.168.5.136:54321/functions/v1/api-v1 \
#   ./scripts/product_quote_invoice_staging_curl_proof.sh
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL is required}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"
API_BASE="${API_BASE:-${SUPABASE_URL}/functions/v1/api-v1}"
API_BASE="${API_BASE%/}"

EMAIL="${PROOF_EMAIL:-pqinv-proof-$(date +%s)-$RANDOM@example.test}"
PASSWORD="${PROOF_PASSWORD:-ProofPass123!}"
SLUG="${PROOF_SLUG:-pqinv-proof-$(date +%s)}"
DISPLAY_NAME="${PROOF_DISPLAY_NAME:-Product Quote Invoice Curl Proof}"
SKU_SUFFIX="${RANDOM}$(date +%s | tail -c 5)"
PRODUCT_SKU="CONV-${SKU_SUFFIX}"
PRODUCT_NAME="Convertible Widget"
PRODUCT_PRICE_CENTS=4500
PRODUCT_PRICE_MUTATED_CENTS=9999
LINE_QTY=2
# 2 * 4500 = 9000 subtotal; 20% tax = 1800; total = 10800
EXPECTED_SUBTOTAL=9000
EXPECTED_TAX=1800
EXPECTED_TOTAL=10800

log() { printf '[pqinv-curl-proof] %s\n' "$*"; }
die() { printf '[pqinv-curl-proof] FAIL: %s\n' "$*" >&2; exit 1; }

# PostgREST may serialize numeric as 2.0000 — compare via tonumber.
num_eq() {
	local actual="$1" expected="$2" label="$3"
	jq -en --arg a "$actual" --arg e "$expected" \
		'(($a | tonumber) == ($e | tonumber))' >/dev/null \
		|| die "${label}: expected ${expected}, got ${actual}"
}

TMPDIR_PROOF="$(mktemp -d)"
trap 'rm -rf "${TMPDIR_PROOF}"' EXIT

# ---------------------------------------------------------------------------
# Bootstrap: signup → JWT → create organisation → client → contact
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
			--arg name "PQInv Proof Org ${SLUG}" \
			--arg slug "$SLUG" \
			'{name:$name, slug:$slug, country_code:"GB", default_currency:"GBP", locale:"en-GB"}')"
)"
ORG_ID="$(printf '%s' "$create_org" | jq -r '.data.organisation.id // empty')"
[[ -n "$ORG_ID" ]] || die "org create failed: ${create_org}"
log "org ${ORG_ID}"

log "POST client"
create_client="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/clients" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n '{name: "Convert Proof Client Ltd", status: "active"}')"
)"
CLIENT_ID="$(printf '%s' "$create_client" | jq -r '.data.id // empty')"
[[ -n "$CLIENT_ID" ]] || die "client create: ${create_client}"
log "client ${CLIENT_ID}"

log "POST contact"
create_contact="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/contacts" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n '{
			display_name: "Convert Contact",
			first_name: "Convert",
			last_name: "Contact",
			primary_email: "convert@example.test",
			lifecycle_status: "active"
		}')"
)"
CONTACT_ID="$(printf '%s' "$create_contact" | jq -r '.data.id // empty')"
[[ -n "$CONTACT_ID" ]] || die "contact create: ${create_contact}"
log "contact ${CONTACT_ID}"

# ---------------------------------------------------------------------------
# Tax rate + product (known SKU / price / tax for snapshot assertions)
# ---------------------------------------------------------------------------
log "POST tax-rates"
create_tax="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/tax-rates" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n '{name: "VAT 20%", rate_percent: 20, is_default: true, active: true}')"
)"
TAX_ID="$(printf '%s' "$create_tax" | jq -r '.data.id // empty')"
[[ -n "$TAX_ID" ]] || die "tax-rate create: ${create_tax}"
log "tax-rate ${TAX_ID}"

log "POST product"
create_product="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/products" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n \
			--arg sku "$PRODUCT_SKU" \
			--arg name "$PRODUCT_NAME" \
			--argjson price "$PRODUCT_PRICE_CENTS" \
			--arg tax "$TAX_ID" \
			'{
				sku: $sku,
				name: $name,
				product_type: "product",
				unit_price_cents: $price,
				currency: "GBP",
				tax_rate_id: $tax,
				status: "active",
				description: "Staging convert-path catalog item"
			}')"
)"
PRODUCT_ID="$(printf '%s' "$create_product" | jq -r '.data.id // empty')"
PRODUCT_VER="$(printf '%s' "$create_product" | jq -r '.data.version // empty')"
[[ -n "$PRODUCT_ID" && -n "$PRODUCT_VER" ]] || die "product create: ${create_product}"
log "product ${PRODUCT_ID} v${PRODUCT_VER} sku=${PRODUCT_SKU} price=${PRODUCT_PRICE_CENTS}"

# ---------------------------------------------------------------------------
# Quote with product line (inherit SKU / price / tax from product)
# ---------------------------------------------------------------------------
log "POST quote draft with product_id line"
create_quote="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/quotes" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n \
			--arg client "$CLIENT_ID" \
			--arg contact "$CONTACT_ID" \
			--arg product "$PRODUCT_ID" \
			--argjson qty "$LINE_QTY" \
			'{
				title: "Product Convert Proof Quote",
				client_id: $client,
				contact_id: $contact,
				currency: "GBP",
				lines: [
					{
						product_id: $product,
						quantity: $qty
					}
				]
			}')"
)"
QUOTE_ID="$(printf '%s' "$create_quote" | jq -r '.data.id // empty')"
QUOTE_VER="$(printf '%s' "$create_quote" | jq -r '.data.version // empty')"
QUOTE_TOTAL="$(printf '%s' "$create_quote" | jq -r '.data.total_cents | tostring')"
QUOTE_SUB="$(printf '%s' "$create_quote" | jq -r '.data.subtotal_cents | tostring')"
QUOTE_TAX="$(printf '%s' "$create_quote" | jq -r '.data.tax_cents | tostring')"
[[ -n "$QUOTE_ID" && -n "$QUOTE_VER" ]] || die "quote create: ${create_quote}"
num_eq "$QUOTE_SUB" "$EXPECTED_SUBTOTAL" "quote.subtotal_cents"
num_eq "$QUOTE_TAX" "$EXPECTED_TAX" "quote.tax_cents"
num_eq "$QUOTE_TOTAL" "$EXPECTED_TOTAL" "quote.total_cents"

Q_LINE_PRODUCT="$(printf '%s' "$create_quote" | jq -r '.data.lines[0].product_id // empty')"
Q_LINE_SKU="$(printf '%s' "$create_quote" | jq -r '.data.lines[0].sku_snapshot // empty')"
Q_LINE_PRICE="$(printf '%s' "$create_quote" | jq -r '.data.lines[0].unit_price_cents | tostring')"
Q_LINE_TAX="$(printf '%s' "$create_quote" | jq -r '.data.lines[0].tax_rate_percent | tostring')"
Q_LINE_DESC="$(printf '%s' "$create_quote" | jq -r '.data.lines[0].description // empty')"
Q_LINE_QTY="$(printf '%s' "$create_quote" | jq -r '.data.lines[0].quantity | tostring')"
[[ "$Q_LINE_PRODUCT" == "$PRODUCT_ID" && "$Q_LINE_SKU" == "$PRODUCT_SKU" && "$Q_LINE_DESC" == "$PRODUCT_NAME" ]] \
	|| die "quote line identity: product=${Q_LINE_PRODUCT} sku=${Q_LINE_SKU} desc=${Q_LINE_DESC}: ${create_quote}"
num_eq "$Q_LINE_PRICE" "$PRODUCT_PRICE_CENTS" "quote.lines[0].unit_price_cents"
num_eq "$Q_LINE_TAX" "20" "quote.lines[0].tax_rate_percent"
num_eq "$Q_LINE_QTY" "$LINE_QTY" "quote.lines[0].quantity"
log "quote ${QUOTE_ID} v${QUOTE_VER} line product_id+snapshots OK (total=${QUOTE_TOTAL})"

log "POST quote accept (from draft)"
accept_quote="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/quotes/${QUOTE_ID}/accept" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${QUOTE_VER}\"" \
		-H 'content-type: application/json' \
		-d '{}'
)"
Q_STATUS="$(printf '%s' "$accept_quote" | jq -r '.data.status // empty')"
[[ "$Q_STATUS" == "accepted" ]] || die "quote accept: ${accept_quote}"
printf '%s' "$accept_quote" | jq -e '.data.party_snapshot.client.id != null' >/dev/null \
	|| die "accept missing party_snapshot.client: ${accept_quote}"
log "quote accepted"

# Mutate live catalog after accept — converted invoice must keep quote-time snapshots.
log "PATCH product price → ${PRODUCT_PRICE_MUTATED_CENTS} (must not leak into invoice)"
patch_product="$(
	curl -fsS --max-time 30 \
		-X PATCH "${API_BASE}/api/v1/products/${PRODUCT_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${PRODUCT_VER}\"" \
		-H 'content-type: application/json' \
		-d "$(jq -n --argjson price "$PRODUCT_PRICE_MUTATED_CENTS" '{unit_price_cents: $price}')"
)"
PATCHED_PRICE="$(printf '%s' "$patch_product" | jq -r '.data.unit_price_cents // empty')"
[[ "$PATCHED_PRICE" == "$PRODUCT_PRICE_MUTATED_CENTS" ]] || die "product patch: ${patch_product}"
log "live product price mutated"

# ---------------------------------------------------------------------------
# Convert accepted quote → invoice draft; assert product_id + snapshots
# ---------------------------------------------------------------------------
log "POST /api/v1/invoices/from-quote"
from_quote="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/invoices/from-quote" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg q "$QUOTE_ID" '{quote_id: $q}')"
)"
FROM_ID="$(printf '%s' "$from_quote" | jq -r '.data.id // empty')"
FROM_SRC="$(printf '%s' "$from_quote" | jq -r '.data.source // empty')"
FROM_Q="$(printf '%s' "$from_quote" | jq -r '.data.quote_id // empty')"
FROM_STATUS="$(printf '%s' "$from_quote" | jq -r '.data.status // empty')"
FROM_TOTAL="$(printf '%s' "$from_quote" | jq -r '.data.total_cents | tostring')"
FROM_SUB="$(printf '%s' "$from_quote" | jq -r '.data.subtotal_cents | tostring')"
FROM_TAX="$(printf '%s' "$from_quote" | jq -r '.data.tax_cents | tostring')"
[[ -n "$FROM_ID" && "$FROM_SRC" == "quote" && "$FROM_Q" == "$QUOTE_ID" && "$FROM_STATUS" == "draft" ]] \
	|| die "from-quote header: ${from_quote}"
num_eq "$FROM_SUB" "$EXPECTED_SUBTOTAL" "invoice.subtotal_cents"
num_eq "$FROM_TAX" "$EXPECTED_TAX" "invoice.tax_cents"
num_eq "$FROM_TOTAL" "$EXPECTED_TOTAL" "invoice.total_cents"

I_LINE_PRODUCT="$(printf '%s' "$from_quote" | jq -r '.data.lines[0].product_id // empty')"
I_LINE_SKU="$(printf '%s' "$from_quote" | jq -r '.data.lines[0].sku_snapshot // empty')"
I_LINE_PRICE="$(printf '%s' "$from_quote" | jq -r '.data.lines[0].unit_price_cents | tostring')"
I_LINE_TAX="$(printf '%s' "$from_quote" | jq -r '.data.lines[0].tax_rate_percent | tostring')"
I_LINE_DESC="$(printf '%s' "$from_quote" | jq -r '.data.lines[0].description // empty')"
I_LINE_QTY="$(printf '%s' "$from_quote" | jq -r '.data.lines[0].quantity | tostring')"
[[ "$I_LINE_PRODUCT" == "$PRODUCT_ID" && "$I_LINE_SKU" == "$PRODUCT_SKU" && "$I_LINE_DESC" == "$PRODUCT_NAME" ]] \
	|| die "invoice line identity (must keep quote-time values, not mutated ${PRODUCT_PRICE_MUTATED_CENTS}): product=${I_LINE_PRODUCT} sku=${I_LINE_SKU} desc=${I_LINE_DESC}: ${from_quote}"
num_eq "$I_LINE_PRICE" "$PRODUCT_PRICE_CENTS" "invoice.lines[0].unit_price_cents"
num_eq "$I_LINE_TAX" "20" "invoice.lines[0].tax_rate_percent"
num_eq "$I_LINE_QTY" "$LINE_QTY" "invoice.lines[0].quantity"

printf '%s' "$from_quote" | jq -e \
	--arg client "$CLIENT_ID" \
	'.data.party_snapshot.client.id == $client' >/dev/null \
	|| die "invoice party_snapshot.client mismatch: ${from_quote}"
log "converted invoice ${FROM_ID} product_id+snapshots OK (frozen through live product mutation)"

log "POST from-quote again (idempotent)"
reconvert_code="$(
	curl -sS --max-time 30 -o "${TMPDIR_PROOF}/reconvert.body" -w '%{http_code}' \
		-X POST "${API_BASE}/api/v1/invoices/from-quote" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg q "$QUOTE_ID" '{quote_id: $q}')"
)"
RE_ID="$(jq -r '.data.id // empty' "${TMPDIR_PROOF}/reconvert.body")"
[[ "$reconvert_code" == "200" && "$RE_ID" == "$FROM_ID" ]] \
	|| die "expected idempotent 200 same id, got ${reconvert_code}: $(cat "${TMPDIR_PROOF}/reconvert.body")"
log "from-quote idempotent PASS"

log "PASS product → quote line → accept → from-quote (product_id + snapshots)"

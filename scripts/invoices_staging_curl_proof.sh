#!/usr/bin/env bash
# Prove invoice draft CRUD, send/void locking, stale If-Match, and accepted-quote
# conversion against a live stack (JWT + X-Org-Id).
#
# Usage:
#   SUPABASE_URL=http://192.168.5.136:54321 \
#   SUPABASE_ANON_KEY=... \
#   API_BASE=http://192.168.5.136:54321/functions/v1/api-v1 \
#   ./scripts/invoices_staging_curl_proof.sh
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL is required}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"
API_BASE="${API_BASE:-${SUPABASE_URL}/functions/v1/api-v1}"
API_BASE="${API_BASE%/}"

EMAIL="${PROOF_EMAIL:-inv-proof-$(date +%s)-$RANDOM@example.test}"
PASSWORD="${PROOF_PASSWORD:-ProofPass123!}"
SLUG="${PROOF_SLUG:-inv-proof-$(date +%s)}"
DISPLAY_NAME="${PROOF_DISPLAY_NAME:-Invoices Curl Proof}"
# Relative to "today" so the proof does not rot after a hard-coded calendar date.
DUE_ON_PRIMARY="$(date -u -d '+30 days' +%Y-%m-%d)"
DUE_ON_SECONDARY="$(date -u -d '+60 days' +%Y-%m-%d)"

log() { printf '[inv-curl-proof] %s\n' "$*"; }
die() { printf '[inv-curl-proof] FAIL: %s\n' "$*" >&2; exit 1; }

TMPDIR_PROOF="$(mktemp -d)"
trap 'rm -rf "${TMPDIR_PROOF}"' EXIT

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
			--arg name "Inv Proof Org ${SLUG}" \
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
		-d "$(jq -n '{name: "Invoice Proof Client Ltd", status: "active"}')"
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
			display_name: "Billing Contact",
			first_name: "Bill",
			last_name: "Contact",
			primary_email: "billing@example.test",
			lifecycle_status: "active"
		}')"
)"
CONTACT_ID="$(printf '%s' "$create_contact" | jq -r '.data.id // empty')"
[[ -n "$CONTACT_ID" ]] || die "contact create: ${create_contact}"
log "contact ${CONTACT_ID}"

# ---------------------------------------------------------------------------
# Draft CRUD + server totals
# ---------------------------------------------------------------------------
log "GET invoices (expect empty)"
list_inv="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/invoices?status=draft" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
printf '%s' "$list_inv" | jq -e '.data | type == "array"' >/dev/null \
	|| die "invoices list shape: ${list_inv}"
[[ "$(printf '%s' "$list_inv" | jq '.data | length')" -eq 0 ]] \
	|| die "expected empty invoices list"

log "POST invoice draft"
create_inv="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/invoices" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg client "$CLIENT_ID" --arg contact "$CONTACT_ID" --arg due "$DUE_ON_PRIMARY" '{
			client_id: $client,
			contact_id: $contact,
			currency: "GBP",
			due_on: $due,
			purchase_order_number: "PO-INV-1",
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
INV_ID="$(printf '%s' "$create_inv" | jq -r '.data.id // empty')"
INV_VER="$(printf '%s' "$create_inv" | jq -r '.data.version // empty')"
INV_STATUS="$(printf '%s' "$create_inv" | jq -r '.data.status // empty')"
INV_TOTAL="$(printf '%s' "$create_inv" | jq -r '.data.total_cents // empty')"
INV_BAL="$(printf '%s' "$create_inv" | jq -r '.data.balance_due_cents // empty')"
LINES="$(printf '%s' "$create_inv" | jq -r '.data.lines | length')"
# 2 × 50000 = 100000 subtotal; 20% tax = 20000; total 120000
[[ -n "$INV_ID" && "$INV_STATUS" == "draft" && "$LINES" == "1" && "$INV_TOTAL" == "120000" && "$INV_BAL" == "120000" ]] \
	|| die "invoice create: ${create_inv}"
log "invoice ${INV_ID} v${INV_VER} total=${INV_TOTAL}"

log "GET invoice"
get_inv="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/invoices/${INV_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
printf '%s' "$get_inv" | jq -e --arg id "$INV_ID" \
	'.data.id == $id and (.data.lines | length) == 1' >/dev/null \
	|| die "invoice get: ${get_inv}"

log "PATCH invoice draft (If-Match + line replace)"
patch_inv="$(
	curl -fsS --max-time 30 \
		-X PATCH "${API_BASE}/api/v1/invoices/${INV_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${INV_VER}\"" \
		-H 'content-type: application/json' \
		-d "$(jq -n '{
			purchase_order_number: "PO-INV-2",
			discount_cents: 10000,
			lines: [
				{
					description: "Consulting half-day",
					quantity: 1,
					unit_price_cents: 25000,
					tax_rate_percent: 20
				}
			]
		}')"
)"
INV_VER="$(printf '%s' "$patch_inv" | jq -r '.data.version // empty')"
PO="$(printf '%s' "$patch_inv" | jq -r '.data.purchase_order_number // empty')"
# Line tax is on pre-discount subtotal: 25000 + 20% tax 5000 − discount 10000 = 20000
TOTAL2="$(printf '%s' "$patch_inv" | jq -r '.data.total_cents // empty')"
[[ "$PO" == "PO-INV-2" && "$TOTAL2" == "20000" && -n "$INV_VER" ]] \
	|| die "invoice patch: ${patch_inv}"
log "invoice patched → v${INV_VER} total=${TOTAL2}"

log "PATCH with stale If-Match (expect 412)"
stale_code="$(
	curl -sS --max-time 30 -o "${TMPDIR_PROOF}/stale.body" -w '%{http_code}' \
		-X PATCH "${API_BASE}/api/v1/invoices/${INV_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'If-Match: "1"' \
		-H 'content-type: application/json' \
		-d "$(jq -n '{purchase_order_number: "STALE"}')"
)"
[[ "$stale_code" == "412" ]] || die "expected 412 on stale If-Match, got ${stale_code}: $(cat "${TMPDIR_PROOF}/stale.body")"
log "stale If-Match rejected"

# ---------------------------------------------------------------------------
# Send → issued lock → void
# ---------------------------------------------------------------------------
log "POST send"
send_inv="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/invoices/${INV_ID}/send" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${INV_VER}\"" \
		-H "Idempotency-Key: inv-send-${INV_ID}" \
		-H 'content-type: application/json' \
		-d '{}'
)"
INV_VER="$(printf '%s' "$send_inv" | jq -r '.data.version // empty')"
STATUS="$(printf '%s' "$send_inv" | jq -r '.data.status // empty')"
SENT_AT="$(printf '%s' "$send_inv" | jq -r '.data.sent_at // empty')"
SNAP="$(printf '%s' "$send_inv" | jq -r '.data.party_snapshot.client.name // empty')"
[[ "$STATUS" == "sent" && -n "$SENT_AT" && -n "$SNAP" && -n "$INV_VER" ]] \
	|| die "invoice send: ${send_inv}"
log "invoice sent → v${INV_VER}"

log "PATCH sent invoice (expect lock / non-draft rejection)"
edit_sent_code="$(
	curl -sS --max-time 30 -o "${TMPDIR_PROOF}/edit-sent.body" -w '%{http_code}' \
		-X PATCH "${API_BASE}/api/v1/invoices/${INV_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${INV_VER}\"" \
		-H 'content-type: application/json' \
		-d "$(jq -n '{purchase_order_number: "LOCKED"}')"
)"
[[ "$edit_sent_code" == "409" || "$edit_sent_code" == "422" ]] \
	|| die "expected 409/422 editing sent invoice, got ${edit_sent_code}: $(cat "${TMPDIR_PROOF}/edit-sent.body")"
log "issued invoice edit locked (${edit_sent_code})"

log "POST void"
void_inv="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/invoices/${INV_ID}/void" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${INV_VER}\"" \
		-H "Idempotency-Key: inv-void-${INV_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n '{void_reason: "Duplicate / curl proof"}')"
)"
STATUS="$(printf '%s' "$void_inv" | jq -r '.data.status // empty')"
REASON="$(printf '%s' "$void_inv" | jq -r '.data.void_reason // empty')"
VOID_BAL="$(printf '%s' "$void_inv" | jq -r '.data.balance_due_cents // empty')"
[[ "$STATUS" == "void" && "$REASON" == "Duplicate / curl proof" && "$VOID_BAL" == "0" ]] \
	|| die "invoice void: ${void_inv}"
log "invoice voided (balance_due_cents=0)"

# ---------------------------------------------------------------------------
# Soft-delete draft
# ---------------------------------------------------------------------------
log "POST second draft for soft-delete"
create_del="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/invoices" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg client "$CLIENT_ID" --arg due "$DUE_ON_SECONDARY" '{
			client_id: $client,
			currency: "GBP",
			due_on: $due,
			lines: [{description: "Delete me", quantity: 1, unit_price_cents: 100, tax_rate_percent: 0}]
		}')"
)"
DEL_ID="$(printf '%s' "$create_del" | jq -r '.data.id // empty')"
DEL_VER="$(printf '%s' "$create_del" | jq -r '.data.version // empty')"
[[ -n "$DEL_ID" && -n "$DEL_VER" ]] || die "second draft create: ${create_del}"

del_code="$(
	curl -sS --max-time 30 -o "${TMPDIR_PROOF}/del.body" -w '%{http_code}' \
		-X DELETE "${API_BASE}/api/v1/invoices/${DEL_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${DEL_VER}\""
)"
[[ "$del_code" == "204" ]] || die "invoice delete HTTP ${del_code}: $(cat "${TMPDIR_PROOF}/del.body")"

gone_code="$(
	curl -sS --max-time 30 -o "${TMPDIR_PROOF}/gone.body" -w '%{http_code}' \
		"${API_BASE}/api/v1/invoices/${DEL_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
[[ "$gone_code" == "404" ]] || die "expected 404 after delete, got ${gone_code}"
log "draft soft-delete PASS"

# ---------------------------------------------------------------------------
# Accepted-quote → invoice conversion (+ idempotent reconvert)
# ---------------------------------------------------------------------------
log "POST quote draft for conversion"
create_quote="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/quotes" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg client "$CLIENT_ID" --arg contact "$CONTACT_ID" '{
			title: "Convertible Proof Quote",
			client_id: $client,
			contact_id: $contact,
			currency: "GBP",
			lines: [
				{
					description: "Quote line",
					quantity: 3,
					unit_price_cents: 10000,
					tax_rate_percent: 20
				}
			]
		}')"
)"
QUOTE_ID="$(printf '%s' "$create_quote" | jq -r '.data.id // empty')"
QUOTE_VER="$(printf '%s' "$create_quote" | jq -r '.data.version // empty')"
QUOTE_TOTAL="$(printf '%s' "$create_quote" | jq -r '.data.total_cents // empty')"
[[ -n "$QUOTE_ID" && -n "$QUOTE_VER" ]] || die "quote create: ${create_quote}"
log "quote ${QUOTE_ID} v${QUOTE_VER} total=${QUOTE_TOTAL}"

log "POST quote accept"
accept_quote="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/quotes/${QUOTE_ID}/accept" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${QUOTE_VER}\"" \
		-H "Idempotency-Key: quote-accept-${QUOTE_ID}" \
		-H 'content-type: application/json' \
		-d '{}'
)"
Q_STATUS="$(printf '%s' "$accept_quote" | jq -r '.data.status // empty')"
[[ "$Q_STATUS" == "accepted" ]] || die "quote accept: ${accept_quote}"
log "quote accepted"

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
FROM_TOTAL="$(printf '%s' "$from_quote" | jq -r '.data.total_cents // empty')"
FROM_STATUS="$(printf '%s' "$from_quote" | jq -r '.data.status // empty')"
[[ -n "$FROM_ID" && "$FROM_SRC" == "quote" && "$FROM_Q" == "$QUOTE_ID" && "$FROM_TOTAL" == "$QUOTE_TOTAL" && "$FROM_STATUS" == "draft" ]] \
	|| die "from-quote: ${from_quote}"
log "converted invoice ${FROM_ID}"

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

log "PASS invoice draft CRUD + send/void lock + accepted-quote conversion"

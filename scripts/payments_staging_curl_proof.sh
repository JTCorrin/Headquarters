#!/usr/bin/env bash
# Prove payments ledger: inbound→invoice allocate/partial/paid/reverse and
# outbound→bill allocate/paid/reverse, plus list filters invoice_id/bill_id.
#
# Usage:
#   SUPABASE_URL=http://192.168.5.136:54321 \
#   SUPABASE_ANON_KEY=... \
#   API_BASE=http://192.168.5.136:54321/functions/v1/api-v1 \
#   ./scripts/payments_staging_curl_proof.sh
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL is required}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"
API_BASE="${API_BASE:-${SUPABASE_URL}/functions/v1/api-v1}"
API_BASE="${API_BASE%/}"

EMAIL="${PROOF_EMAIL:-payments-proof-$(date +%s)-$RANDOM@example.test}"
PASSWORD="${PROOF_PASSWORD:-ProofPass123!}"
SLUG="${PROOF_SLUG:-payments-proof-$(date +%s)}"
DISPLAY_NAME="${PROOF_DISPLAY_NAME:-Payments Curl Proof}"
DUE_ON="$(date -u -d '+30 days' +%Y-%m-%d 2>/dev/null || date -u -v+30d +%Y-%m-%d)"

log() { printf '[payments-curl-proof] %s\n' "$*"; }
die() { printf '[payments-curl-proof] FAIL: %s\n' "$*" >&2; exit 1; }

TMPDIR_PROOF="$(mktemp -d)"
trap 'rm -rf "${TMPDIR_PROOF}"' EXIT

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
		-d "$(jq -n --arg name "Payments Proof Org ${SLUG}" --arg slug "$SLUG" \
			'{name:$name, slug:$slug, country_code:"GB", default_currency:"GBP", locale:"en-GB"}')"
)"
ORG_ID="$(printf '%s' "$create_org" | jq -r '.data.organisation.id // empty')"
[[ -n "$ORG_ID" ]] || die "org create failed: ${create_org}"
log "org ${ORG_ID}"

H=(-H "apikey: ${SUPABASE_ANON_KEY}" -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "X-Org-Id: ${ORG_ID}")

log "POST client"
create_client="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/clients" \
		"${H[@]}" \
		-H 'content-type: application/json' \
		-d '{"name":"Payments Proof Client","status":"active"}'
)"
CLIENT_ID="$(printf '%s' "$create_client" | jq -r '.data.id // empty')"
[[ -n "$CLIENT_ID" ]] || die "client create: ${create_client}"

log "POST contact"
create_contact="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/contacts" \
		"${H[@]}" \
		-H 'content-type: application/json' \
		-d '{"display_name":"Pay Contact","primary_email":"pay@example.test","lifecycle_status":"active"}'
)"
CONTACT_ID="$(printf '%s' "$create_contact" | jq -r '.data.id // empty')"
[[ -n "$CONTACT_ID" ]] || die "contact create: ${create_contact}"

log "POST vendor"
create_vendor="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/vendors" \
		"${H[@]}" \
		-H 'content-type: application/json' \
		-d '{"name":"Payments Proof Vendor","status":"active","primary_email":"vendor@example.test"}'
)"
VENDOR_ID="$(printf '%s' "$create_vendor" | jq -r '.data.id // empty')"
[[ -n "$VENDOR_ID" ]] || die "vendor create: ${create_vendor}"

log "POST invoice draft + send"
create_inv="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/invoices" \
		"${H[@]}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg client "$CLIENT_ID" --arg contact "$CONTACT_ID" --arg due "$DUE_ON" '{
			client_id: $client,
			contact_id: $contact,
			currency: "GBP",
			due_on: $due,
			lines: [{description: "Consulting", quantity: 1, unit_price_cents: 10000, tax_rate_percent: 20}]
		}')"
)"
INV_ID="$(printf '%s' "$create_inv" | jq -r '.data.id // empty')"
INV_VER="$(printf '%s' "$create_inv" | jq -r '.data.version // empty')"
INV_TOTAL="$(printf '%s' "$create_inv" | jq -r '.data.total_cents // empty')"
[[ -n "$INV_ID" && "$INV_TOTAL" == "12000" ]] || die "invoice create: ${create_inv}"

send_inv="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/invoices/${INV_ID}/send" \
		"${H[@]}" \
		-H "If-Match: \"${INV_VER}\"" \
		-H "Idempotency-Key: pay-proof-inv-send-${INV_ID}" \
		-H 'content-type: application/json' \
		-d '{}'
)"
INV_STATUS="$(printf '%s' "$send_inv" | jq -r '.data.status // empty')"
[[ "$INV_STATUS" == "sent" ]] || die "invoice send: ${send_inv}"
log "invoice ${INV_ID} sent total=${INV_TOTAL}"

log "POST bill draft + receive"
create_bill="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/bills" \
		"${H[@]}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg v "$VENDOR_ID" --arg d "$DUE_ON" \
			'{vendor_id:$v, number:"PAY-PROOF-1", currency:"GBP", due_on:$d,
			  lines:[{description:"Office supplies", quantity:1, unit_price_cents:5000, tax_rate_percent:20, position:0}]}')"
)"
BILL_ID="$(printf '%s' "$create_bill" | jq -r '.data.id // empty')"
BILL_VER="$(printf '%s' "$create_bill" | jq -r '.data.version // empty')"
BILL_TOTAL="$(printf '%s' "$create_bill" | jq -r '.data.total_cents // empty')"
[[ -n "$BILL_ID" && "$BILL_TOTAL" == "6000" ]] || die "bill create: ${create_bill}"

recv_bill="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/bills/${BILL_ID}/receive" \
		"${H[@]}" \
		-H "If-Match: \"${BILL_VER}\"" \
		-H "Idempotency-Key: pay-proof-bill-receive-${BILL_ID}" \
		-H 'content-type: application/json' \
		-d '{}'
)"
BILL_STATUS="$(printf '%s' "$recv_bill" | jq -r '.data.status // empty')"
[[ "$BILL_STATUS" == "received" ]] || die "bill receive: ${recv_bill}"
log "bill ${BILL_ID} received total=${BILL_TOTAL}"

# ---------------------------------------------------------------------------
# Inbound partial → remaining → reverse
# ---------------------------------------------------------------------------
IDEM_CREATE="pay-create-$(date +%s)-$RANDOM"
log "POST payment inbound partial (Idempotency-Key)"
create_pay="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/payments" \
		"${H[@]}" \
		-H "Idempotency-Key: ${IDEM_CREATE}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg client "$CLIENT_ID" --arg inv "$INV_ID" '{
			direction: "inbound",
			client_id: $client,
			amount_cents: 5000,
			currency: "GBP",
			method: "bank",
			allocations: [{invoice_id: $inv, amount_cents: 5000}]
		}')"
)"
PAY_ID="$(printf '%s' "$create_pay" | jq -r '.data.id // empty')"
PAY_VER="$(printf '%s' "$create_pay" | jq -r '.data.version // empty')"
PAY_STATUS="$(printf '%s' "$create_pay" | jq -r '.data.status // empty')"
[[ -n "$PAY_ID" && "$PAY_STATUS" == "completed" && -n "$PAY_VER" ]] \
	|| die "payment create: ${create_pay}"
log "payment ${PAY_ID} v${PAY_VER}"

log "idempotent replay create"
replay_pay="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/payments" \
		"${H[@]}" \
		-H "Idempotency-Key: ${IDEM_CREATE}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg client "$CLIENT_ID" --arg inv "$INV_ID" '{
			direction: "inbound",
			client_id: $client,
			amount_cents: 5000,
			currency: "GBP",
			method: "bank",
			allocations: [{invoice_id: $inv, amount_cents: 5000}]
		}')"
)"
REPLAY_ID="$(printf '%s' "$replay_pay" | jq -r '.data.id // empty')"
[[ "$REPLAY_ID" == "$PAY_ID" ]] || die "idempotent replay mismatch: ${replay_pay}"

get_inv="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/invoices/${INV_ID}" \
		"${H[@]}"
)"
printf '%s' "$get_inv" | jq -e \
	'.data.status == "partial" and .data.paid_cents == 5000 and .data.balance_due_cents == 7000' \
	>/dev/null || die "invoice after partial pay: ${get_inv}"

log "GET payments?invoice_id="
list_by_inv="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/payments?invoice_id=${INV_ID}" \
		"${H[@]}"
)"
printf '%s' "$list_by_inv" | jq -e --arg id "$PAY_ID" \
	'[.data[].id] | index($id) != null' >/dev/null \
	|| die "list by invoice_id missing payment: ${list_by_inv}"

log "GET payments with both invoice_id and bill_id (expect 400)"
both_code="$(
	curl -sS --max-time 30 -o "${TMPDIR_PROOF}/both.body" -w '%{http_code}' \
		"${API_BASE}/api/v1/payments?invoice_id=${INV_ID}&bill_id=${BILL_ID}" \
		"${H[@]}"
)"
[[ "$both_code" == "400" ]] || die "expected 400 for mutually exclusive filters, got ${both_code}"

log "POST payment remaining balance → paid"
create_pay2="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/payments" \
		"${H[@]}" \
		-H "Idempotency-Key: pay-rest-$(date +%s)-$RANDOM" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg client "$CLIENT_ID" --arg inv "$INV_ID" '{
			direction: "inbound",
			client_id: $client,
			amount_cents: 7000,
			currency: "GBP",
			method: "bank",
			allocations: [{invoice_id: $inv, amount_cents: 7000}]
		}')"
)"
[[ "$(printf '%s' "$create_pay2" | jq -r '.data.id // empty')" != "" ]] \
	|| die "second payment: ${create_pay2}"

get_inv="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/invoices/${INV_ID}" \
		"${H[@]}"
)"
printf '%s' "$get_inv" | jq -e \
	'.data.status == "paid" and .data.paid_cents == 12000 and .data.balance_due_cents == 0' \
	>/dev/null || die "invoice after full pay: ${get_inv}"

# Refresh payment version before reverse (allocate/status updates may bump it)
get_pay="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/payments/${PAY_ID}" \
		"${H[@]}"
)"
PAY_VER="$(printf '%s' "$get_pay" | jq -r '.data.version // empty')"
[[ -n "$PAY_VER" ]] || die "payment get: ${get_pay}"

log "POST reverse first payment"
rev_pay="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/payments/${PAY_ID}/reverse" \
		"${H[@]}" \
		-H "If-Match: \"${PAY_VER}\"" \
		-H "Idempotency-Key: pay-rev-$(date +%s)-$RANDOM" \
		-H 'content-type: application/json' \
		-d '{"reason":"Proof reversal"}'
)"
REV_STATUS="$(printf '%s' "$rev_pay" | jq -r '.data.status // empty')"
[[ "$REV_STATUS" == "reversed" ]] || die "payment reverse: ${rev_pay}"

get_inv="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/invoices/${INV_ID}" \
		"${H[@]}"
)"
printf '%s' "$get_inv" | jq -e \
	'.data.status == "partial" and .data.paid_cents == 7000 and .data.balance_due_cents == 5000' \
	>/dev/null || die "invoice after reverse: ${get_inv}"
log "inbound path ok"

# ---------------------------------------------------------------------------
# Outbound → bill
# ---------------------------------------------------------------------------
log "POST payment outbound full bill"
create_out="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/payments" \
		"${H[@]}" \
		-H "Idempotency-Key: pay-out-$(date +%s)-$RANDOM" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg vendor "$VENDOR_ID" --arg bill "$BILL_ID" --argjson amt "$BILL_TOTAL" '{
			direction: "outbound",
			vendor_id: $vendor,
			amount_cents: $amt,
			currency: "GBP",
			method: "bank",
			allocations: [{bill_id: $bill, amount_cents: $amt}]
		}')"
)"
OUT_ID="$(printf '%s' "$create_out" | jq -r '.data.id // empty')"
OUT_VER="$(printf '%s' "$create_out" | jq -r '.data.version // empty')"
[[ -n "$OUT_ID" && -n "$OUT_VER" ]] || die "outbound payment: ${create_out}"

get_bill="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/bills/${BILL_ID}" \
		"${H[@]}"
)"
printf '%s' "$get_bill" | jq -e \
	'.data.status == "paid" and .data.paid_cents == 6000 and .data.balance_due_cents == 0' \
	>/dev/null || die "bill after pay: ${get_bill}"

log "GET payments?bill_id="
list_by_bill="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/payments?bill_id=${BILL_ID}" \
		"${H[@]}"
)"
printf '%s' "$list_by_bill" | jq -e --arg id "$OUT_ID" \
	'[.data[].id] | index($id) != null' >/dev/null \
	|| die "list by bill_id missing payment: ${list_by_bill}"

log "POST reverse outbound payment"
rev_out="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/payments/${OUT_ID}/reverse" \
		"${H[@]}" \
		-H "If-Match: \"${OUT_VER}\"" \
		-H "Idempotency-Key: pay-out-rev-$(date +%s)-$RANDOM" \
		-H 'content-type: application/json' \
		-d '{"reason":"Outbound proof reversal"}'
)"
[[ "$(printf '%s' "$rev_out" | jq -r '.data.status // empty')" == "reversed" ]] \
	|| die "outbound reverse: ${rev_out}"

get_bill="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/bills/${BILL_ID}" \
		"${H[@]}"
)"
printf '%s' "$get_bill" | jq -e \
	'.data.status == "received" and .data.paid_cents == 0 and .data.balance_due_cents == 6000' \
	>/dev/null || die "bill after reverse: ${get_bill}"

log "PASS"

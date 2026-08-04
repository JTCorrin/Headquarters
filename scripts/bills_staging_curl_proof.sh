#!/usr/bin/env bash
# Prove vendor + bill draft CRUD, receive/void locking, and stale If-Match
# against a live stack (JWT + X-Org-Id).
#
# Usage:
#   SUPABASE_URL=http://192.168.5.136:54321 \
#   SUPABASE_ANON_KEY=... \
#   API_BASE=http://192.168.5.136:54321/functions/v1/api-v1 \
#   ./scripts/bills_staging_curl_proof.sh
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL is required}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"
API_BASE="${API_BASE:-${SUPABASE_URL}/functions/v1/api-v1}"
API_BASE="${API_BASE%/}"

EMAIL="${PROOF_EMAIL:-bills-proof-$(date +%s)-$RANDOM@example.test}"
PASSWORD="${PROOF_PASSWORD:-ProofPass123!}"
SLUG="${PROOF_SLUG:-bills-proof-$(date +%s)}"
DISPLAY_NAME="${PROOF_DISPLAY_NAME:-Bills Curl Proof}"
DUE_ON="$(date -u -d '+30 days' +%Y-%m-%d 2>/dev/null || date -u -v+30d +%Y-%m-%d)"

log() { printf '[bills-curl-proof] %s\n' "$*"; }
die() { printf '[bills-curl-proof] FAIL: %s\n' "$*" >&2; exit 1; }

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
		-d "$(jq -n --arg name "Bills Proof Org ${SLUG}" --arg slug "$SLUG" \
			'{name:$name, slug:$slug, country_code:"GB", default_currency:"GBP", locale:"en-GB"}')"
)"
ORG_ID="$(printf '%s' "$create_org" | jq -r '.data.organisation.id // empty')"
[[ -n "$ORG_ID" ]] || die "org create failed: ${create_org}"
log "org ${ORG_ID}"

log "POST vendors"
create_vendor="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/vendors" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d '{"name":"Proof Vendor Ltd","status":"active","primary_email":"vendor@example.test"}'
)"
VENDOR_ID="$(printf '%s' "$create_vendor" | jq -r '.data.id // empty')"
VENDOR_EMAIL="$(printf '%s' "$create_vendor" | jq -r '.data.primary_email // empty')"
[[ "$VENDOR_EMAIL" == "vendor@example.test" ]] || die "vendor primary_email dropped: ${create_vendor}"
[[ -n "$VENDOR_ID" ]] || die "vendor create: ${create_vendor}"
log "vendor ${VENDOR_ID}"

log "POST bills (draft)"
create_bill="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/bills" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg v "$VENDOR_ID" --arg d "$DUE_ON" \
			'{vendor_id:$v, number:"PV-1001", currency:"GBP", due_on:$d, discount_cents:100,
			  lines:[{description:"Office supplies", quantity:2, unit_price_cents:2500, tax_rate_percent:20, position:0}]}')"
)"
BILL_ID="$(printf '%s' "$create_bill" | jq -r '.data.id // empty')"
BILL_VER="$(printf '%s' "$create_bill" | jq -r '.data.version // empty')"
TOTAL="$(printf '%s' "$create_bill" | jq -r '.data.total_cents // empty')"
STATUS="$(printf '%s' "$create_bill" | jq -r '.data.status // empty')"
# 2×2500=5000 subtotal; line tax 20%=1000; header discount 100 → total 5900
[[ -n "$BILL_ID" && "$STATUS" == "draft" && "$TOTAL" == "5900" && -n "$BILL_VER" ]] \
	|| die "bill create: ${create_bill}"
log "bill ${BILL_ID} v${BILL_VER} total=${TOTAL}"

log "GET bill"
get_bill="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/bills/${BILL_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
printf '%s' "$get_bill" | jq -e --arg id "$BILL_ID" \
	'.data.id == $id and .data.status == "draft"' >/dev/null \
	|| die "bill get: ${get_bill}"

log "PATCH bill draft (If-Match)"
patch_bill="$(
	curl -fsS --max-time 30 \
		-X PATCH "${API_BASE}/api/v1/bills/${BILL_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${BILL_VER}\"" \
		-H 'content-type: application/json' \
		-d '{"notes":"Updated via curl proof"}'
)"
BILL_VER="$(printf '%s' "$patch_bill" | jq -r '.data.version // empty')"
[[ "$(printf '%s' "$patch_bill" | jq -r '.data.notes')" == "Updated via curl proof" && -n "$BILL_VER" ]] \
	|| die "bill patch: ${patch_bill}"

log "PATCH with stale If-Match (expect 412)"
stale_code="$(
	curl -sS --max-time 30 -o "${TMPDIR_PROOF}/stale.body" -w '%{http_code}' \
		-X PATCH "${API_BASE}/api/v1/bills/${BILL_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'If-Match: "1"' \
		-H 'content-type: application/json' \
		-d '{"notes":"should fail"}'
)"
[[ "$stale_code" == "412" ]] || die "expected 412 on stale If-Match, got ${stale_code}: $(cat "${TMPDIR_PROOF}/stale.body")"
log "stale If-Match rejected"

log "POST receive"
receive_bill="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/bills/${BILL_ID}/receive" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${BILL_VER}\"" \
		-H "Idempotency-Key: bill-receive-${BILL_ID}" \
		-H 'content-type: application/json' \
		-d '{}'
)"
BILL_VER="$(printf '%s' "$receive_bill" | jq -r '.data.version // empty')"
STATUS="$(printf '%s' "$receive_bill" | jq -r '.data.status // empty')"
RECEIVED_ON="$(printf '%s' "$receive_bill" | jq -r '.data.received_on // empty')"
SNAP="$(printf '%s' "$receive_bill" | jq -r '.data.party_snapshot.vendor.name // empty')"
[[ "$STATUS" == "received" && -n "$RECEIVED_ON" && "$SNAP" == "Proof Vendor Ltd" && -n "$BILL_VER" ]] \
	|| die "bill receive: ${receive_bill}"
log "bill received → v${BILL_VER}"

log "PATCH received bill (expect 409)"
locked_code="$(
	curl -sS --max-time 30 -o "${TMPDIR_PROOF}/locked.body" -w '%{http_code}' \
		-X PATCH "${API_BASE}/api/v1/bills/${BILL_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${BILL_VER}\"" \
		-H 'content-type: application/json' \
		-d '{"notes":"locked"}'
)"
[[ "$locked_code" == "409" ]] || die "expected 409 for edit after receive, got ${locked_code}: $(cat "${TMPDIR_PROOF}/locked.body")"

log "POST void"
void_bill="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/bills/${BILL_ID}/void" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${BILL_VER}\"" \
		-H "Idempotency-Key: bill-void-${BILL_ID}" \
		-H 'content-type: application/json' \
		-d '{"void_reason":"Curl proof void"}'
)"
STATUS="$(printf '%s' "$void_bill" | jq -r '.data.status // empty')"
BAL="$(printf '%s' "$void_bill" | jq -r '.data.balance_due_cents // empty')"
[[ "$STATUS" == "void" && "$BAL" == "0" ]] || die "bill void: ${void_bill}"

log "PASS vendor + bill draft CRUD + receive/void + stale If-Match"

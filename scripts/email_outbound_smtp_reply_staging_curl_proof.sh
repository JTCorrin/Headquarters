#!/usr/bin/env bash
# Prove reply-first SMTP outbound against a live stack (synthetic *.example.test):
#   signup → org → mailbox → sync inbound → POST …/reply (+ Idempotency-Key replay)
#
# Usage:
#   SUPABASE_URL=http://192.168.5.136:54321 \
#   SUPABASE_ANON_KEY=... \
#   API_BASE=http://192.168.5.136:54321/functions/v1/api-v1 \
#   ./scripts/email_outbound_smtp_reply_staging_curl_proof.sh
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL is required}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"
API_BASE="${API_BASE:-${SUPABASE_URL}/functions/v1/api-v1}"
API_BASE="${API_BASE%/}"

EMAIL="${PROOF_EMAIL:-smtp-reply-proof-$(date +%s)-$RANDOM@example.test}"
PASSWORD="${PROOF_PASSWORD:-ProofPass123!}"
SLUG="${PROOF_SLUG:-smtp-reply-$(date +%s)}"
DISPLAY_NAME="${PROOF_DISPLAY_NAME:-SMTP Reply Curl Proof}"
MAIL_PASSWORD="${PROOF_MAIL_PASSWORD:-mailbox-secret-$RANDOM}"
PEER_EMAIL="${PROOF_PEER_EMAIL:-peer@example.test}"

log() { printf '[smtp-reply-curl-proof] %s\n' "$*"; }
die() { printf '[smtp-reply-curl-proof] FAIL: %s\n' "$*" >&2; exit 1; }

assert_no_secret_echo() {
	local label="$1" json="$2"
	if printf '%s' "$json" | jq -e '
		[..]
		| objects
		| keys_unsorted[]
		| select(. == "secret_ref" or . == "password" or . == "api_key")
	' >/dev/null 2>&1; then
		die "${label}: response echoed a secret field"
	fi
	if printf '%s' "$json" | grep -Fqi -- "$MAIL_PASSWORD"; then
		die "${label}: response echoed mailbox password plaintext"
	fi
}

api() {
	local method="$1" path="$2"
	shift 2
	curl -sS --max-time 60 -X "$method" "${API_BASE}${path}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-H "x-request-id: smtp-reply-$(date +%s)-$RANDOM" \
		"$@"
}

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

log "POST organisations"
create_json="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/organisations" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H 'content-type: application/json' \
		-d "$(jq -n \
			--arg name "SMTP Reply Org ${SLUG}" \
			--arg slug "$SLUG" \
			'{name:$name, slug:$slug, country_code:"GB", default_currency:"GBP", locale:"en-GB"}')"
)"
ORG_ID="$(printf '%s' "$create_json" | jq -r '.data.organisation.id // empty')"
[[ -n "$ORG_ID" ]] || die "organisation create failed: ${create_json}"

log "PUT mailbox (synthetic smtp.example.test)"
put_json="$(
	api PUT /api/v1/me/mailbox --data "$(jq -n \
		--arg email "mail.${SLUG}@example.test" \
		--arg pass "$MAIL_PASSWORD" \
		'{
			email_address:$email,
			from_name:"SMTP Proof Mailer",
			imap_host:"imap.example.test",
			imap_port:993,
			imap_security:"tls",
			smtp_host:"smtp.example.test",
			smtp_port:587,
			smtp_security:"starttls",
			username:$email,
			password:$pass
		}')"
)"
printf '%s' "$put_json" | jq -e '.data.credentials_configured == true' >/dev/null \
	|| die "PUT mailbox failed: ${put_json}"
assert_no_secret_echo "PUT mailbox" "$put_json"

log "POST contact for address_match"
contact_json="$(
	api POST /api/v1/contacts --data "$(jq -n \
		--arg email "$PEER_EMAIL" \
		'{display_name:"SMTP Peer Contact", primary_email:$email}')"
)"
CONTACT_ID="$(printf '%s' "$contact_json" | jq -r '.data.id // empty')"
[[ -n "$CONTACT_ID" ]] || die "contact create failed: ${contact_json}"

log "POST client for address_match (entity rail)"
client_json="$(
	api POST /api/v1/clients --data "$(jq -n \
		--arg email "$PEER_EMAIL" \
		'{name:"SMTP Peer Client", primary_email:$email, status:"active"}')"
)"
CLIENT_ID="$(printf '%s' "$client_json" | jq -r '.data.id // empty')"
[[ -n "$CLIENT_ID" ]] || die "client create failed: ${client_json}"

log "POST mailbox/sync (synthetic inbound parent)"
sync_json="$(api POST /api/v1/me/mailbox/sync --data '{}')"
printf '%s' "$sync_json" | jq -e '.data.ok == true and .data.ingested >= 1' >/dev/null \
	|| die "mailbox sync failed: ${sync_json}"

mine_json="$(api GET /api/v1/me/email-messages)"
PARENT_ID="$(printf '%s' "$mine_json" | jq -r '.data[0].id // empty')"
[[ -n "$PARENT_ID" ]] || die "missing inbound parent after sync: ${mine_json}"
log "parent message ${PARENT_ID}"

IDEMPOTENCY_KEY="smtp-reply-$(date +%s)-$RANDOM"
REPLY_BODY='Thanks — synthetic SMTP reply proof.'

log "POST email-messages/{id}/reply (synthetic SMTP)"
reply_json="$(
	api POST "/api/v1/email-messages/${PARENT_ID}/reply" \
		-H "Idempotency-Key: ${IDEMPOTENCY_KEY}" \
		--data "$(jq -n --arg body "$REPLY_BODY" '{body_text:$body, body_html:null}')"
)"
printf '%s' "$reply_json" | jq -e '
	.data.id != null
	and .data.direction == "outbound"
	and .data.status == "sent"
	and .data.in_reply_to_message_id != null
	and (.data.subject | startswith("Re:"))
	and (.data.body_text | contains("synthetic SMTP reply proof"))
	and (.data.provider_message_id | type == "string" and length > 0)
' >/dev/null || die "reply send failed: ${reply_json}"
assert_no_secret_echo "POST reply" "$reply_json"
OUTBOUND_ID="$(printf '%s' "$reply_json" | jq -r '.data.id')"
log "outbound ${OUTBOUND_ID} status=sent"

log "GET clients/{id}/email-messages (outbound linked + sent_at/to)"
client_mail_json="$(api GET "/api/v1/clients/${CLIENT_ID}/email-messages")"
printf '%s' "$client_mail_json" | jq -e --arg oid "$OUTBOUND_ID" --arg pid "$PARENT_ID" '
	([.data[] | select(.id == $pid)] | length) == 1
	and ([.data[] | select(.id == $oid)] | length) == 1
	and (.data[] | select(.id == $oid) | .direction == "outbound")
	and (.data[] | select(.id == $oid) | .sent_at != null)
	and (.data[] | select(.id == $oid) | .to_addresses | type == "array" and length >= 1)
' >/dev/null || die "client entity list missing outbound/sent_at/to: ${client_mail_json}"

log "POST reply replay (same Idempotency-Key)"
replay_json="$(
	api POST "/api/v1/email-messages/${PARENT_ID}/reply" \
		-H "Idempotency-Key: ${IDEMPOTENCY_KEY}" \
		--data "$(jq -n --arg body "$REPLY_BODY" '{body_text:$body, body_html:null}')"
)"
printf '%s' "$replay_json" | jq -e --arg id "$OUTBOUND_ID" '
	.data.id == $id
	and .data.status == "sent"
' >/dev/null || die "idempotent replay mismatch: ${replay_json}"
assert_no_secret_echo "POST reply replay" "$replay_json"

log "POST reply without Idempotency-Key → 400"
no_key_code="$(
	curl -sS --max-time 30 -o /tmp/smtp-reply-nokey.json -w '%{http_code}' \
		-X POST "${API_BASE}/api/v1/email-messages/${PARENT_ID}/reply" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		--data "$(jq -n --arg body "$REPLY_BODY" '{body_text:$body}')"
)"
[[ "$no_key_code" == "400" ]] || die "expected 400 without Idempotency-Key, got ${no_key_code}"

log "PASS synthetic SMTP reply + entity link + idempotent replay"

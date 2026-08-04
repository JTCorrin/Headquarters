#!/usr/bin/env bash
# Prove Notif-BE: empty unread → synthetic mailbox sync creates email.received →
# list/unread-count → PATCH mark-read → re-upsert same provider id does not duplicate.
#
# Usage:
#   SUPABASE_URL=http://192.168.5.136:54321 \
#   SUPABASE_ANON_KEY=... \
#   SUPABASE_SERVICE_ROLE_KEY=... \
#   API_BASE=http://192.168.5.136:54321/functions/v1/api-v1 \
#   ./scripts/notifications_staging_curl_proof.sh
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL is required}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY is required for re-upsert dedupe proof}"
API_BASE="${API_BASE:-${SUPABASE_URL}/functions/v1/api-v1}"
API_BASE="${API_BASE%/}"

EMAIL="${PROOF_EMAIL:-notif-proof-$(date +%s)-$RANDOM@example.test}"
PASSWORD="${PROOF_PASSWORD:-ProofPass123!}"
SLUG="${PROOF_SLUG:-notif-proof-$(date +%s)}"
DISPLAY_NAME="${PROOF_DISPLAY_NAME:-Notifications Curl Proof}"
MAIL_PASSWORD="${PROOF_MAIL_PASSWORD:-MailPass123!}"

log() { printf '[notifications-curl-proof] %s\n' "$*"; }
die() { printf '[notifications-curl-proof] FAIL: %s\n' "$*" >&2; exit 1; }

api() {
	local method="$1"
	local path="$2"
	shift 2
	curl -sS --max-time 45 -X "$method" "${API_BASE}${path}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		"$@"
}

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

log "POST organisations"
create_org="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/organisations" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg name "Notif Proof Org ${SLUG}" --arg slug "$SLUG" \
			'{name:$name, slug:$slug, country_code:"GB", default_currency:"GBP", locale:"en-GB"}')"
)"
ORG_ID="$(printf '%s' "$create_org" | jq -r '.data.organisation.id // empty')"
[[ -n "$ORG_ID" ]] || die "org create failed: ${create_org}"

log "GET unread-count (expect 0)"
count0="$(api GET /api/v1/me/notifications/unread-count)"
printf '%s' "$count0" | jq -e '.data.count == 0' >/dev/null \
	|| die "expected unread 0: ${count0}"

log "GET notifications (expect empty)"
list0="$(api GET /api/v1/me/notifications)"
printf '%s' "$list0" | jq -e '.data | type == "array" and length == 0' >/dev/null \
	|| die "expected empty notifications: ${list0}"

log "PUT mailbox (synthetic imap.example.test)"
put_json="$(
	api PUT /api/v1/me/mailbox --data "$(jq -n \
		--arg email "mail.${SLUG}@example.test" \
		--arg pass "$MAIL_PASSWORD" \
		'{
			email_address:$email,
			from_name:"Notif Proof Mailer",
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
MAILBOX_ID="$(printf '%s' "$put_json" | jq -r '.data.id // empty')"
[[ -n "$MAILBOX_ID" ]] || die "PUT mailbox failed: ${put_json}"

log "POST mailbox/sync (creates inbound + notification)"
sync_json="$(api POST /api/v1/me/mailbox/sync --data '{}')"
printf '%s' "$sync_json" | jq -e '.data.ok == true and .data.ingested >= 1' >/dev/null \
	|| die "mailbox sync failed: ${sync_json}"

log "GET unread-count (expect >= 1)"
count1="$(api GET /api/v1/me/notifications/unread-count)"
printf '%s' "$count1" | jq -e '.data.count >= 1' >/dev/null \
	|| die "expected unread >= 1: ${count1}"
UNREAD_BEFORE="$(printf '%s' "$count1" | jq -r '.data.count')"

log "GET notifications (expect email.received)"
list1="$(api GET /api/v1/me/notifications)"
printf '%s' "$list1" | jq -e '
	(.data | type == "array" and length >= 1)
	and .data[0].kind == "email.received"
	and .data[0].source_type == "email_message"
	and (.data[0].source_id | type == "string" and length > 0)
	and .data[0].read_at == null
' >/dev/null || die "notifications list missing email.received: ${list1}"
NOTIF_ID="$(printf '%s' "$list1" | jq -r '.data[0].id')"
SOURCE_ID="$(printf '%s' "$list1" | jq -r '.data[0].source_id')"
PROVIDER_ID="$(
	curl -fsS --max-time 30 \
		"${SUPABASE_URL}/rest/v1/email_messages?id=eq.${SOURCE_ID}&select=provider_message_id,mailbox_account_id" \
		-H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
		-H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
	| jq -r '.[0].provider_message_id // empty'
)"
[[ -n "$PROVIDER_ID" ]] || die "could not resolve provider_message_id for ${SOURCE_ID}"

log "PATCH mark-read ${NOTIF_ID}"
mark_json="$(api PATCH "/api/v1/me/notifications/${NOTIF_ID}" --data '{"read":true}')"
printf '%s' "$mark_json" | jq -e --arg id "$NOTIF_ID" \
	'.data.id == $id and (.data.read_at | type == "string")' >/dev/null \
	|| die "mark-read failed: ${mark_json}"

log "GET unread-count after mark-read"
count2="$(api GET /api/v1/me/notifications/unread-count)"
printf '%s' "$count2" | jq -e --argjson before "$UNREAD_BEFORE" \
	'.data.count == (($before - 1) | if . < 0 then 0 else . end)' >/dev/null \
	|| die "expected unread decremented: before=${UNREAD_BEFORE} after=${count2}"

log "service-role re-upsert same provider id (no duplicate)"
reupsert="$(
	curl -fsS --max-time 30 \
		-X POST "${SUPABASE_URL}/rest/v1/rpc/upsert_inbound_email_message" \
		-H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
		-H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
		-H 'content-type: application/json' \
		-d "$(jq -n \
			--arg org "$ORG_ID" \
			--arg mailbox "$MAILBOX_ID" \
			--arg pid "$PROVIDER_ID" \
			'{
				p_org_id:$org,
				p_mailbox_id:$mailbox,
				p_provider_message_id:$pid,
				p_provider_thread_id:("thread-" + $pid),
				p_from_address:"client@example.test",
				p_from_name:"Client",
				p_to_addresses:[{"email":"owner@example.test"}],
				p_subject:"Re-sync subject",
				p_body_text:"Re-sync body",
				p_preview_text:"Re-sync preview",
				p_received_at:(now | strftime("%Y-%m-%dT%H:%M:%SZ")),
				p_body_truncated:false
			}')"
)"
printf '%s' "$reupsert" | jq -e --arg id "$SOURCE_ID" '.id == $id' >/dev/null \
	|| die "re-upsert unexpected: ${reupsert}"

list_after="$(api GET /api/v1/me/notifications?limit=200)"
dup_count="$(printf '%s' "$list_after" | jq --arg sid "$SOURCE_ID" \
	'[.data[] | select(.source_id == $sid and .kind == "email.received")] | length')"
[[ "$dup_count" == "1" ]] || die "expected exactly 1 notification for source ${SOURCE_ID}, got ${dup_count}: ${list_after}"

log "OK — Notif-BE curl proof passed"

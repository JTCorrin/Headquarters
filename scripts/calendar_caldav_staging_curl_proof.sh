#!/usr/bin/env bash
# Prove CalDAV-BE: PUT connect (no secret echo) → meeting push sets caldav ids →
# update/delete clear path → Test PROPFIND synthetic → disconnect.
#
# Synthetic host short-circuits CalDAV (no network). Staging Edge should allow
# CALENDAR_SYNC_STAGING_STUB / synthetic *.example.test (same as mailbox).
#
# Usage:
#   SUPABASE_URL=http://192.168.5.136:54321 \
#   SUPABASE_ANON_KEY=... \
#   API_BASE=http://192.168.5.136:54321/functions/v1/api-v1 \
#   ./scripts/calendar_caldav_staging_curl_proof.sh
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL is required}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"
API_BASE="${API_BASE:-${SUPABASE_URL}/functions/v1/api-v1}"
API_BASE="${API_BASE%/}"

EMAIL="${PROOF_EMAIL:-caldav-proof-$(date +%s)-$RANDOM@example.test}"
PASSWORD="${PROOF_PASSWORD:-ProofPass123!}"
SLUG="${PROOF_SLUG:-caldav-proof-$(date +%s)}"
DISPLAY_NAME="${PROOF_DISPLAY_NAME:-CalDAV Curl Proof}"
CALDAV_URL="${PROOF_CALDAV_URL:-https://caldav.example.test/SOGo/dav/proof/Calendar/personal/}"
CALDAV_USER="${PROOF_CALDAV_USER:-proof@example.test}"
CALDAV_PASS="${PROOF_CALDAV_PASS:-caldav-app-password}"

log() { printf '[calendar-caldav-curl-proof] %s\n' "$*"; }
die() { printf '[calendar-caldav-curl-proof] FAIL: %s\n' "$*" >&2; exit 1; }

assert_no_secret_echo() {
	local label="$1"
	local json="$2"
	if printf '%s' "$json" | jq -e '
		.. | objects | keys[]?
		| select(test("^(secret_ref|password|api_key|refresh_token|access_token|token_blob)$"))
	' >/dev/null 2>&1; then
		die "${label}: secret key echoed: ${json}"
	fi
}

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
		-d "$(jq -n --arg name "CalDAV Proof Org ${SLUG}" --arg slug "$SLUG" \
			'{name:$name, slug:$slug, country_code:"GB", default_currency:"GBP", locale:"en-GB", timezone:"Europe/London"}')"
)"
ORG_ID="$(printf '%s' "$create_org" | jq -r '.data.organisation.id // empty')"
[[ -n "$ORG_ID" ]] || die "org create failed: ${create_org}"

log "GET /me/calendar (disconnected)"
status_json="$(api GET /api/v1/me/calendar)"
assert_no_secret_echo "GET calendar disconnected" "$status_json"
printf '%s' "$status_json" | jq -e '
	.data.credentials_configured == false
	and (.data.status == "disconnected" or .data.status == null)
' >/dev/null || die "expected disconnected calendar: ${status_json}"

log "PUT /me/calendar CalDAV connect"
put_json="$(
	api PUT /api/v1/me/calendar --data "$(jq -n \
		--arg url "$CALDAV_URL" \
		--arg user "$CALDAV_USER" \
		--arg pass "$CALDAV_PASS" \
		'{provider:"caldav", caldav_url:$url, username:$user, password:$pass}')"
)"
assert_no_secret_echo "PUT caldav" "$put_json"
printf '%s' "$put_json" | jq -e '
	.data.provider == "caldav"
	and .data.status == "active"
	and .data.credentials_configured == true
	and (.data.caldav_url != null or .data.config.caldav_url != null)
' >/dev/null || die "expected active caldav connection: ${put_json}"

log "POST /me/calendar/test (synthetic)"
test_json="$(api POST /api/v1/me/calendar/test --data '{}')"
assert_no_secret_echo "POST test" "$test_json"
printf '%s' "$test_json" | jq -e '.data.ok == true' >/dev/null \
	|| die "expected test ok: ${test_json}"

log "POST meeting (stub/synthetic push sets reserved cols)"
pushed="$(
	api POST /api/v1/meetings --data "$(jq -n \
		'{title:"CalDAV after connect", starts_at:"2026-09-02T10:00:00.000Z", ends_at:"2026-09-02T10:30:00.000Z", timezone:"UTC"}')"
)"
PUSHED_ID="$(printf '%s' "$pushed" | jq -r '.data.id // empty')"
EXT_ID="$(printf '%s' "$pushed" | jq -r '.data.external_event_id // empty')"
PROVIDER="$(printf '%s' "$pushed" | jq -r '.data.calendar_provider // empty')"
VERSION="$(printf '%s' "$pushed" | jq -r '.data.version // empty')"
[[ -n "$PUSHED_ID" ]] || die "pushed create failed: ${pushed}"
[[ "$PROVIDER" == "caldav" ]] || die "expected calendar_provider=caldav: ${pushed}"
[[ -n "$EXT_ID" && "$EXT_ID" != null ]] || die "expected external_event_id: ${pushed}"

log "PATCH meeting (update push keeps provider)"
updated="$(
	api PATCH "/api/v1/meetings/${PUSHED_ID}" \
		-H "If-Match: \"${VERSION}\"" \
		--data '{"title":"CalDAV updated"}'
)"
printf '%s' "$updated" | jq -e '
	.data.calendar_provider == "caldav"
	and (.data.external_event_id != null)
' >/dev/null || die "expected caldav ids after update: ${updated}"
VERSION="$(printf '%s' "$updated" | jq -r '.data.version // empty')"

log "DELETE meeting (cancel clears reserved cols)"
del_code="$(
	curl -sS --max-time 30 -o /tmp/caldav-del.json -w '%{http_code}' \
		-X DELETE "${API_BASE}/api/v1/meetings/${PUSHED_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${VERSION}\""
)"
[[ "$del_code" == "204" || "$del_code" == "200" ]] ||
	die "expected meeting delete success, got ${del_code}: $(cat /tmp/caldav-del.json)"

log "DELETE /me/calendar?provider=caldav"
disc_code="$(
	curl -sS --max-time 30 -o /tmp/caldav-disc.json -w '%{http_code}' \
		-X DELETE "${API_BASE}/api/v1/me/calendar?provider=caldav" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
[[ "$disc_code" == "204" ]] || die "expected 204 disconnect, got ${disc_code}: $(cat /tmp/caldav-disc.json)"

log "POST meeting after disconnect → reserved cols null"
after="$(
	api POST /api/v1/meetings --data "$(jq -n \
		'{title:"After caldav disconnect", starts_at:"2026-09-03T10:00:00.000Z", ends_at:"2026-09-03T10:30:00.000Z", timezone:"UTC"}')"
)"
printf '%s' "$after" | jq -e '
	.data.calendar_provider == null and .data.external_event_id == null
' >/dev/null || die "expected null reserved cols after disconnect: ${after}"

log "OK calendar CalDAV staging curl proof"

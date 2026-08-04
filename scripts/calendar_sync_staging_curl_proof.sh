#!/usr/bin/env bash
# Prove Cal-Sync-BE: reserved cols reject client PATCH; /me/calendar status;
# stub OAuth connect → push sets external ids; disconnect → create leaves nulls.
#
# Requires CALENDAR_SYNC_STAGING_STUB=1 on the Edge function (default staging proof path).
#
# Usage:
#   SUPABASE_URL=http://192.168.5.136:54321 \
#   SUPABASE_ANON_KEY=... \
#   API_BASE=http://192.168.5.136:54321/functions/v1/api-v1 \
#   ./scripts/calendar_sync_staging_curl_proof.sh
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL is required}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"
API_BASE="${API_BASE:-${SUPABASE_URL}/functions/v1/api-v1}"
API_BASE="${API_BASE%/}"

EMAIL="${PROOF_EMAIL:-cal-sync-proof-$(date +%s)-$RANDOM@example.test}"
PASSWORD="${PROOF_PASSWORD:-ProofPass123!}"
SLUG="${PROOF_SLUG:-cal-sync-proof-$(date +%s)}"
DISPLAY_NAME="${PROOF_DISPLAY_NAME:-Cal Sync Curl Proof}"

log() { printf '[calendar-sync-curl-proof] %s\n' "$*"; }
die() { printf '[calendar-sync-curl-proof] FAIL: %s\n' "$*" >&2; exit 1; }

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
		-d "$(jq -n --arg name "Cal Sync Proof Org ${SLUG}" --arg slug "$SLUG" \
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

log "POST meeting (no connection — reserved cols null)"
create_meeting="$(
	api POST /api/v1/meetings --data "$(jq -n \
		'{title:"Before connect", starts_at:"2026-09-01T10:00:00.000Z", ends_at:"2026-09-01T10:30:00.000Z", timezone:"UTC"}')"
)"
MEETING_ID="$(printf '%s' "$create_meeting" | jq -r '.data.id // empty')"
VERSION="$(printf '%s' "$create_meeting" | jq -r '.data.version // empty')"
[[ -n "$MEETING_ID" ]] || die "create meeting failed: ${create_meeting}"
printf '%s' "$create_meeting" | jq -e '
	.data.calendar_provider == null and .data.external_event_id == null
' >/dev/null || die "expected null reserved cols before connect: ${create_meeting}"

log "PATCH reserved cols → 422"
patch_code="$(
	curl -sS --max-time 30 -o /tmp/cal-sync-patch.json -w '%{http_code}' \
		-X PATCH "${API_BASE}/api/v1/meetings/${MEETING_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${VERSION}\"" \
		-H 'content-type: application/json' \
		--data '{"calendar_provider":"google","external_event_id":"evil"}'
)"
[[ "$patch_code" == "422" ]] || die "expected 422 for reserved PATCH, got ${patch_code}: $(cat /tmp/cal-sync-patch.json)"
jq -e '.error.fields.calendar_provider and .error.fields.external_event_id' /tmp/cal-sync-patch.json >/dev/null \
	|| die "expected field errors: $(cat /tmp/cal-sync-patch.json)"

log "OAuth start (stub)"
start_json="$(api GET /api/v1/me/calendar/oauth/start)"
assert_no_secret_echo "oauth start" "$start_json"
STATE="$(printf '%s' "$start_json" | jq -r '.data.state // empty')"
CALLBACK_URL="$(printf '%s' "$start_json" | jq -r '.data.url // empty')"
[[ -n "$STATE" && -n "$CALLBACK_URL" ]] || die "oauth start missing url/state: ${start_json}"

log "OAuth callback (stub)"
# Hit callback via API_BASE path so X-Org-Id + JWT apply (stub url may be absolute).
cb_path="/api/v1/me/calendar/oauth/callback?code=stub&state=${STATE}"
cb_json="$(api GET "$cb_path")"
assert_no_secret_echo "oauth callback" "$cb_json"
printf '%s' "$cb_json" | jq -e '.data.credentials_configured == true and .data.status == "active"' >/dev/null \
	|| die "expected active connection: ${cb_json}"

log "GET /me/calendar (connected)"
connected="$(api GET /api/v1/me/calendar)"
assert_no_secret_echo "GET calendar connected" "$connected"
printf '%s' "$connected" | jq -e '.data.credentials_configured == true' >/dev/null \
	|| die "expected credentials_configured: ${connected}"

log "POST meeting (stub push sets reserved cols)"
pushed="$(
	api POST /api/v1/meetings --data "$(jq -n \
		'{title:"After connect", starts_at:"2026-09-02T10:00:00.000Z", ends_at:"2026-09-02T10:30:00.000Z", timezone:"UTC"}')"
)"
PUSHED_ID="$(printf '%s' "$pushed" | jq -r '.data.id // empty')"
EXT_ID="$(printf '%s' "$pushed" | jq -r '.data.external_event_id // empty')"
PROVIDER="$(printf '%s' "$pushed" | jq -r '.data.calendar_provider // empty')"
[[ -n "$PUSHED_ID" ]] || die "pushed create failed: ${pushed}"
[[ "$PROVIDER" == "google" ]] || die "expected calendar_provider=google: ${pushed}"
[[ -n "$EXT_ID" && "$EXT_ID" != null ]] || die "expected external_event_id: ${pushed}"
[[ "$EXT_ID" == stub-* ]] || die "expected stub-* external id in stub mode: ${pushed}"

log "DELETE /me/calendar (disconnect)"
disc_code="$(
	curl -sS --max-time 30 -o /tmp/cal-sync-disc.json -w '%{http_code}' \
		-X DELETE "${API_BASE}/api/v1/me/calendar" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
[[ "$disc_code" == "204" ]] || die "expected 204 disconnect, got ${disc_code}: $(cat /tmp/cal-sync-disc.json)"

log "POST meeting after disconnect → reserved cols null"
after="$(
	api POST /api/v1/meetings --data "$(jq -n \
		'{title:"After disconnect", starts_at:"2026-09-03T10:00:00.000Z", ends_at:"2026-09-03T10:30:00.000Z", timezone:"UTC"}')"
)"
printf '%s' "$after" | jq -e '
	.data.calendar_provider == null and .data.external_event_id == null
' >/dev/null || die "expected null reserved cols after disconnect: ${after}"

log "OK calendar sync staging curl proof"

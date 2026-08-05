#!/usr/bin/env bash
# Prove org-wide GET /api/v1/timeline-events (primary-rail) against a live stack.
#
# Usage:
#   SUPABASE_URL=http://192.168.5.136:54321 \
#   SUPABASE_ANON_KEY=... \
#   API_BASE=http://192.168.5.136:54321/functions/v1/api-v1 \
#   ./scripts/org_timeline_staging_curl_proof.sh
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL is required}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"
API_BASE="${API_BASE:-${SUPABASE_URL}/functions/v1/api-v1}"
API_BASE="${API_BASE%/}"

EMAIL="${PROOF_EMAIL:-orgtl-proof-$(date +%s)-$RANDOM@example.test}"
PASSWORD="${PROOF_PASSWORD:-ProofPass123!}"
SLUG="${PROOF_SLUG:-orgtl-proof-$(date +%s)}"
DISPLAY_NAME="${PROOF_DISPLAY_NAME:-Org Timeline Curl Proof}"

log() { printf '[orgtl-curl-proof] %s\n' "$*"; }
die() { printf '[orgtl-curl-proof] FAIL: %s\n' "$*" >&2; exit 1; }

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
			--arg name "Org TL Proof ${SLUG}" \
			--arg slug "$SLUG" \
			'{name:$name, slug:$slug, country_code:"GB", default_currency:"GBP", locale:"en-GB"}')"
)"
ORG_ID="$(printf '%s' "$create_org" | jq -r '.data.organisation.id // empty')"
[[ -n "$ORG_ID" ]] || die "org create failed: ${create_org}"

auth=(-H "apikey: ${SUPABASE_ANON_KEY}" -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "X-Org-Id: ${ORG_ID}")

CLIENT_ID="$(
	curl -fsS --max-time 30 -X POST "${API_BASE}/api/v1/clients" \
		"${auth[@]}" -H 'content-type: application/json' \
		-d '{"name":"Org TL Client","status":"active"}' | jq -r '.data.id // empty'
)"
[[ -n "$CLIENT_ID" ]] || die "client create failed"

CONTACT_ID="$(
	curl -fsS --max-time 30 -X POST "${API_BASE}/api/v1/contacts" \
		"${auth[@]}" -H 'content-type: application/json' \
		-d '{"display_name":"Org TL Contact","primary_email":"orgtl@example.test","lifecycle_status":"active"}' \
		| jq -r '.data.id // empty'
)"
[[ -n "$CONTACT_ID" ]] || die "contact create failed"

log "POST quote (fans out quote + client timeline cards)"
quote_json="$(
	curl -fsS --max-time 30 -X POST "${API_BASE}/api/v1/quotes" \
		"${auth[@]}" -H 'content-type: application/json' \
		-d "$(jq -n \
			--arg client "$CLIENT_ID" \
			'{
				title: "Org TL Proof Quote",
				client_id: $client,
				currency: "GBP",
				lines: []
			}')"
)"
QUOTE_ID="$(printf '%s' "$quote_json" | jq -r '.data.id // empty')"
[[ -n "$QUOTE_ID" ]] || die "quote create: ${quote_json}"

log "POST composer note on contact"
note_json="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/entities/contact/${CONTACT_ID}/timeline-events" \
		"${auth[@]}" -H 'content-type: application/json' \
		-d '{"title":"Proof note","kind":"note"}'
)"
NOTE_ID="$(printf '%s' "$note_json" | jq -r '.data.id // empty')"
[[ -n "$NOTE_ID" ]] || die "note create: ${note_json}"

log "GET /api/v1/timeline-events (org primary-rail)"
feed_json="$(
	curl -fsS --max-time 30 \
		-X GET "${API_BASE}/api/v1/timeline-events?limit=50" \
		"${auth[@]}"
)"
FEED_LEN="$(printf '%s' "$feed_json" | jq -r '.data | length')"
[[ "$FEED_LEN" != "null" && "$FEED_LEN" -ge 2 ]] || die "feed too short: ${feed_json}"

QUOTE_CREATED_COUNT="$(printf '%s' "$feed_json" | jq -r '[.data[] | select(.payload.action == "quote.created")] | length')"
[[ "$QUOTE_CREATED_COUNT" == "1" ]] || die "expected 1 quote.created primary card, got ${QUOTE_CREATED_COUNT}: ${feed_json}"

NOTE_PRESENT="$(printf '%s' "$feed_json" | jq -r --arg id "$NOTE_ID" '[.data[] | select(.id == $id)] | length')"
[[ "$NOTE_PRESENT" == "1" ]] || die "composer note missing from org feed: ${feed_json}"

CLIENT_FANOUT="$(printf '%s' "$feed_json" | jq -r \
	--arg q "$QUOTE_ID" \
	'[.data[] | select(.entity_type == "client" and .source_type == "quote" and .source_id == $q)] | length')"
[[ "$CLIENT_FANOUT" == "0" ]] || die "client fan-out leaked into org feed: ${feed_json}"

log "GET with limit=1 for cursor"
page1="$(
	curl -fsS --max-time 30 \
		-X GET "${API_BASE}/api/v1/timeline-events?limit=1" \
		"${auth[@]}"
)"
CURSOR="$(printf '%s' "$page1" | jq -r '.meta.next_cursor // empty')"
PAGE1_ID="$(printf '%s' "$page1" | jq -r '.data[0].id // empty')"
[[ -n "$CURSOR" && -n "$PAGE1_ID" ]] || die "expected next_cursor on page1: ${page1}"

page2="$(
	curl -fsS --max-time 30 \
		-G "${API_BASE}/api/v1/timeline-events" \
		--data-urlencode "limit=50" \
		--data-urlencode "cursor=${CURSOR}" \
		"${auth[@]}"
)"
PAGE2_HAS_FIRST="$(printf '%s' "$page2" | jq -r --arg id "$PAGE1_ID" '[.data[] | select(.id == $id)] | length')"
[[ "$PAGE2_HAS_FIRST" == "0" ]] || die "cursor page repeated first id: ${page2}"

log "POST org timeline must 405"
post_code="$(
	curl -sS --max-time 30 -o /tmp/orgtl-post.json -w '%{http_code}' \
		-X POST "${API_BASE}/api/v1/timeline-events" \
		"${auth[@]}" -H 'content-type: application/json' \
		-d '{"title":"nope"}'
)"
[[ "$post_code" == "405" ]] || die "expected 405 for POST org timeline, got ${post_code}"

log "PASS org timeline events curl proof"

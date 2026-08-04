#!/usr/bin/env bash
# Prove M2 meeting assistant: transcript attach → generate-summary → accept → task.
#
# Usage:
#   SUPABASE_URL=http://192.168.5.136:54321 \
#   SUPABASE_ANON_KEY=... \
#   API_BASE=http://192.168.5.136:54321/functions/v1/api-v1 \
#   ./scripts/meeting_assistant_staging_curl_proof.sh
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL is required}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"
API_BASE="${API_BASE:-${SUPABASE_URL}/functions/v1/api-v1}"
API_BASE="${API_BASE%/}"

EMAIL="${PROOF_EMAIL:-m2-proof-$(date +%s)-$RANDOM@example.test}"
PASSWORD="${PROOF_PASSWORD:-ProofPass123!}"
SLUG="${PROOF_SLUG:-m2-proof-$(date +%s)}"
DISPLAY_NAME="${PROOF_DISPLAY_NAME:-Meeting Assistant Curl Proof}"

log() { printf '[meeting-assistant-curl-proof] %s\n' "$*"; }
die() { printf '[meeting-assistant-curl-proof] FAIL: %s\n' "$*" >&2; exit 1; }

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
		-d "$(jq -n --arg name "M2 Proof Org ${SLUG}" --arg slug "$SLUG" \
			'{name:$name, slug:$slug, country_code:"GB", default_currency:"GBP", locale:"en-GB", timezone:"Europe/London"}')"
)"
ORG_ID="$(printf '%s' "$create_org" | jq -r '.data.organisation.id // empty')"
[[ -n "$ORG_ID" ]] || die "org create failed: ${create_org}"
log "org ${ORG_ID}"

STARTS="$(date -u -d '+3 days' +%Y-%m-%dT10:00:00.000Z 2>/dev/null || date -u -v+3d +%Y-%m-%dT10:00:00.000Z)"
ENDS="$(date -u -d '+3 days 1 hour' +%Y-%m-%dT11:00:00.000Z 2>/dev/null || date -u -v+3d -v+1H +%Y-%m-%dT11:00:00.000Z)"

log "POST clients (related entity for inherit + timeline)"
create_client="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/clients" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d '{"name":"M2 Proof Client","status":"active"}'
)"
CLIENT_ID="$(printf '%s' "$create_client" | jq -r '.data.id // empty')"
[[ -n "$CLIENT_ID" ]] || die "client create: ${create_client}"
log "client ${CLIENT_ID}"

log "POST meetings (related client)"
create_meeting="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/meetings" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg starts "$STARTS" --arg ends "$ENDS" --arg c "$CLIENT_ID" \
			'{title:"M2 assistant proof", starts_at:$starts, ends_at:$ends,
			  related_entity_type:"client", related_entity_id:$c}')"
)"
MEETING_ID="$(printf '%s' "$create_meeting" | jq -r '.data.id // empty')"
MEETING_VER="$(printf '%s' "$create_meeting" | jq -r '.data.version // empty')"
[[ -n "$MEETING_ID" && -n "$MEETING_VER" ]] || die "meeting create: ${create_meeting}"
log "meeting ${MEETING_ID} v${MEETING_VER}"

log "GET client timeline for meeting.scheduled"
timeline_sched="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/entities/client/${CLIENT_ID}/timeline-events?limit=20" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
SCHED_COUNT="$(printf '%s' "$timeline_sched" | jq -r --arg mid "$MEETING_ID" \
	'[.data[]? | select(.kind == "meeting" and (.payload.action // "") == "meeting.scheduled" and (.payload.meeting_id // "") == $mid)] | length')"
[[ "$SCHED_COUNT" == "1" ]] || die "expected meeting.scheduled timeline card: ${timeline_sched}"

log "POST transcript (plain_text stub path)"
transcript_code="$(
	curl -sS --max-time 30 -o "${TMPDIR_PROOF}/transcript.json" -w '%{http_code}' \
		-X POST "${API_BASE}/api/v1/meetings/${MEETING_ID}/transcript" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${MEETING_VER}\"" \
		-H 'content-type: application/json' \
		-d '{"plain_text":"Action: draft quote\nAction: book follow-up call\nAction: share notes","status":"ready"}'
)"
transcript_json="$(cat "${TMPDIR_PROOF}/transcript.json")"
[[ "$transcript_code" == "200" ]] || die "transcript HTTP ${transcript_code}: ${transcript_json}"
MEETING_VER="$(printf '%s' "$transcript_json" | jq -r '.data.version // empty')"
T_STATUS="$(printf '%s' "$transcript_json" | jq -r '.data.transcript_status // empty')"
T_ROW="$(printf '%s' "$transcript_json" | jq -r '.data.transcript.status // empty')"
[[ "$T_STATUS" == "ready" && "$T_ROW" == "ready" && -n "$MEETING_VER" ]] \
	|| die "transcript attach: ${transcript_json}"
log "transcript ready v${MEETING_VER}"

log "POST generate-summary"
summary_code="$(
	curl -sS --max-time 30 -o "${TMPDIR_PROOF}/summary.json" -w '%{http_code}' \
		-X POST "${API_BASE}/api/v1/meetings/${MEETING_ID}/generate-summary" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${MEETING_VER}\"" \
		-H 'content-type: application/json' \
		-d '{}'
)"
summary_json="$(cat "${TMPDIR_PROOF}/summary.json")"
[[ "$summary_code" == "200" ]] || die "generate-summary HTTP ${summary_code}: ${summary_json}"
MEETING_VER="$(printf '%s' "$summary_json" | jq -r '.data.version // empty')"
S_STATUS="$(printf '%s' "$summary_json" | jq -r '.data.summary_status // empty')"
SUMMARY="$(printf '%s' "$summary_json" | jq -r '.data.summary // empty')"
PROPOSAL_COUNT="$(printf '%s' "$summary_json" | jq -r '.data.task_proposals | length')"
PROPOSAL_ID="$(printf '%s' "$summary_json" | jq -r '.data.task_proposals[0].id // empty')"
[[ "$S_STATUS" == "ready" && -n "$SUMMARY" && "$PROPOSAL_COUNT" -ge 1 && -n "$PROPOSAL_ID" && -n "$MEETING_VER" ]] \
	|| die "generate-summary: ${summary_json}"
log "summary ready proposals=${PROPOSAL_COUNT} v${MEETING_VER}"

log "POST accept proposal"
accept_code="$(
	curl -sS --max-time 30 -o "${TMPDIR_PROOF}/accept.json" -w '%{http_code}' \
		-X POST "${API_BASE}/api/v1/meetings/${MEETING_ID}/task-proposals/${PROPOSAL_ID}/accept" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d '{}'
)"
accept_json="$(cat "${TMPDIR_PROOF}/accept.json")"
[[ "$accept_code" == "200" ]] || die "accept HTTP ${accept_code}: ${accept_json}"
TASK_ID="$(printf '%s' "$accept_json" | jq -r '.meta.accepted_task_id // empty')"
PROP_STATUS="$(printf '%s' "$accept_json" | jq -r --arg id "$PROPOSAL_ID" \
	'[.data.task_proposals[]? | select(.id == $id) | .status][0] // empty')"
[[ -n "$TASK_ID" && "$PROP_STATUS" == "accepted" ]] || die "accept: ${accept_json}"
log "accepted task ${TASK_ID}"

log "GET task proves meeting source + related-entity inherit"
task_json="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/tasks/${TASK_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
TASK_SOURCE="$(printf '%s' "$task_json" | jq -r '.data.source // empty')"
TASK_MEETING="$(printf '%s' "$task_json" | jq -r '.data.meeting_id // empty')"
TASK_ENTITY_TYPE="$(printf '%s' "$task_json" | jq -r '.data.entity_type // empty')"
TASK_ENTITY_ID="$(printf '%s' "$task_json" | jq -r '.data.entity_id // empty')"
[[ "$TASK_SOURCE" == "meeting" && "$TASK_MEETING" == "$MEETING_ID" ]] \
	|| die "task get: ${task_json}"
[[ "$TASK_ENTITY_TYPE" == "client" && "$TASK_ENTITY_ID" == "$CLIENT_ID" ]] \
	|| die "task missing related-entity inherit: ${task_json}"

log "GET tasks?meeting_id= filter"
tasks_by_meeting="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/tasks?meeting_id=${MEETING_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
FILTER_COUNT="$(printf '%s' "$tasks_by_meeting" | jq -r --arg id "$TASK_ID" \
	'[.data[]? | select(.id == $id)] | length')"
[[ "$FILTER_COUNT" == "1" ]] || die "meeting_id filter missed task: ${tasks_by_meeting}"

log "GET client timeline for meeting.task_accepted"
timeline_accept="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/entities/client/${CLIENT_ID}/timeline-events?limit=20" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
ACCEPT_TL="$(printf '%s' "$timeline_accept" | jq -r --arg tid "$TASK_ID" \
	'[.data[]? | select(.kind == "task" and (.payload.action // "") == "meeting.task_accepted" and (.payload.task_id // "") == $tid)] | length')"
[[ "$ACCEPT_TL" == "1" ]] || die "expected meeting.task_accepted timeline card: ${timeline_accept}"

log "OK meeting assistant proof passed"

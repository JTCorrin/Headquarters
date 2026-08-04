#!/usr/bin/env bash
# Prove meetings CRUD, nested attendees replace-all, upcoming filter, and stale If-Match
# against a live stack (JWT + X-Org-Id).
#
# Usage:
#   SUPABASE_URL=http://192.168.5.136:54321 \
#   SUPABASE_ANON_KEY=... \
#   API_BASE=http://192.168.5.136:54321/functions/v1/api-v1 \
#   ./scripts/meetings_staging_curl_proof.sh
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL is required}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"
API_BASE="${API_BASE:-${SUPABASE_URL}/functions/v1/api-v1}"
API_BASE="${API_BASE%/}"

EMAIL="${PROOF_EMAIL:-meetings-proof-$(date +%s)-$RANDOM@example.test}"
PASSWORD="${PROOF_PASSWORD:-ProofPass123!}"
SLUG="${PROOF_SLUG:-meetings-proof-$(date +%s)}"
DISPLAY_NAME="${PROOF_DISPLAY_NAME:-Meetings Curl Proof}"

log() { printf '[meetings-curl-proof] %s\n' "$*"; }
die() { printf '[meetings-curl-proof] FAIL: %s\n' "$*" >&2; exit 1; }

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
		-d "$(jq -n --arg name "Meetings Proof Org ${SLUG}" --arg slug "$SLUG" \
			'{name:$name, slug:$slug, country_code:"GB", default_currency:"GBP", locale:"en-GB", timezone:"Europe/London"}')"
)"
ORG_ID="$(printf '%s' "$create_org" | jq -r '.data.organisation.id // empty')"
[[ -n "$ORG_ID" ]] || die "org create failed: ${create_org}"
log "org ${ORG_ID}"

MEMBERSHIP_ID="$(printf '%s' "$create_org" | jq -r '.data.membership.id // empty')"
if [[ -z "$MEMBERSHIP_ID" || "$MEMBERSHIP_ID" == null ]]; then
	orgs_json="$(
		curl -fsS --max-time 30 \
			"${API_BASE}/api/v1/organisations" \
			-H "apikey: ${SUPABASE_ANON_KEY}" \
			-H "Authorization: Bearer ${ACCESS_TOKEN}"
	)"
	MEMBERSHIP_ID="$(printf '%s' "$orgs_json" | jq -r --arg oid "$ORG_ID" '
		[.data[]? | select(.organisation.id == $oid or .id == $oid) | .membership.id // .membership_id][0] // empty
	')"
fi
[[ -n "$MEMBERSHIP_ID" && "$MEMBERSHIP_ID" != null ]] || die "could not resolve membership id"
log "membership ${MEMBERSHIP_ID}"

log "POST clients (related entity + project link)"
create_client="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/clients" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d '{"name":"Proof Client","status":"active"}'
)"
CLIENT_ID="$(printf '%s' "$create_client" | jq -r '.data.id // empty')"
[[ -n "$CLIENT_ID" ]] || die "client create: ${create_client}"
log "client ${CLIENT_ID}"

log "POST projects (meeting related entity target)"
create_project="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/projects" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg c "$CLIENT_ID" '{client_id:$c, name:"Proof project"}')"
)"
PROJECT_ID="$(printf '%s' "$create_project" | jq -r '.data.id // empty')"
[[ -n "$PROJECT_ID" ]] || die "project create: ${create_project}"
log "project ${PROJECT_ID}"

log "POST contacts (related entity)"
create_contact="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/contacts" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d '{"display_name":"Proof Contact","primary_email":"contact@meetings-proof.test"}'
)"
CONTACT_ID="$(printf '%s' "$create_contact" | jq -r '.data.id // empty')"
[[ -n "$CONTACT_ID" ]] || die "contact create: ${create_contact}"
log "contact ${CONTACT_ID}"

STARTS="$(date -u -d '+2 days' +%Y-%m-%dT10:00:00.000Z 2>/dev/null || date -u -v+2d +%Y-%m-%dT10:00:00.000Z)"
ENDS="$(date -u -d '+2 days 1 hour' +%Y-%m-%dT11:00:00.000Z 2>/dev/null || date -u -v+2d -v+1H +%Y-%m-%dT11:00:00.000Z)"

log "POST meetings"
create_meeting="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/meetings" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n \
			--arg starts "$STARTS" \
			--arg ends "$ENDS" \
			--arg c "$CONTACT_ID" \
			--arg m "$MEMBERSHIP_ID" \
			'{
				title:"Proof standup",
				starts_at:$starts,
				ends_at:$ends,
				related_entity_type:"contact",
				related_entity_id:$c,
				organiser_membership_id:$m,
				attendees:[
					{email:"contact@meetings-proof.test", name:"Proof Contact", contact_id:$c, organiser:true},
					{email:"guest@meetings-proof.test", name:"Guest"}
				]
			}')"
)"
MEETING_ID="$(printf '%s' "$create_meeting" | jq -r '.data.id // empty')"
MEETING_VER="$(printf '%s' "$create_meeting" | jq -r '.data.version // empty')"
ATTENDEE_COUNT="$(printf '%s' "$create_meeting" | jq -r '.data.attendees | length')"
TZ_VAL="$(printf '%s' "$create_meeting" | jq -r '.data.timezone // empty')"
LABEL="$(printf '%s' "$create_meeting" | jq -r '.data.related_entity_label // empty')"
[[ -n "$MEETING_ID" && -n "$MEETING_VER" && "$ATTENDEE_COUNT" == "2" && "$TZ_VAL" == "Europe/London" && "$LABEL" == "Proof Contact" ]] \
	|| die "meeting create: ${create_meeting}"
log "meeting ${MEETING_ID} v${MEETING_VER}"

log "GET contact timeline for meeting.scheduled"
timeline_sched="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/entities/contact/${CONTACT_ID}/timeline-events?limit=20" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
SCHED_COUNT="$(printf '%s' "$timeline_sched" | jq -r --arg mid "$MEETING_ID" \
	'[.data[]? | select(.kind == "meeting" and (.payload.action // "") == "meeting.scheduled" and (.payload.meeting_id // "") == $mid)] | length')"
[[ "$SCHED_COUNT" == "1" ]] || die "expected meeting.scheduled on contact timeline: ${timeline_sched}"

log "GET meetings?upcoming=true"
list_up="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/meetings?upcoming=true&limit=5" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
LIST_COUNT="$(printf '%s' "$list_up" | jq -r --arg id "$MEETING_ID" '[.data[]? | select(.id == $id)] | length')"
[[ "$LIST_COUNT" == "1" ]] || die "upcoming list missing meeting: ${list_up}"

log "PATCH meetings attendees replace-all with If-Match"
patch_code="$(
	curl -sS --max-time 30 -o "${TMPDIR_PROOF}/patch.json" -w '%{http_code}' \
		-X PATCH "${API_BASE}/api/v1/meetings/${MEETING_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${MEETING_VER}\"" \
		-H 'content-type: application/json' \
		-d '{"status":"in_progress","attendees":[{"email":"only@meetings-proof.test","organiser":true}]}'
)"
patch_meeting="$(cat "${TMPDIR_PROOF}/patch.json")"
[[ "$patch_code" == "200" ]] || die "meeting patch HTTP ${patch_code}: ${patch_meeting}"
MEETING_VER2="$(printf '%s' "$patch_meeting" | jq -r '.data.version // empty')"
PATCH_STATUS="$(printf '%s' "$patch_meeting" | jq -r '.data.status // empty')"
PATCH_ATTENDEES="$(printf '%s' "$patch_meeting" | jq -r '.data.attendees | length')"
PATCH_EMAIL="$(printf '%s' "$patch_meeting" | jq -r '.data.attendees[0].email // empty')"
[[ "$PATCH_STATUS" == "in_progress" && -n "$MEETING_VER2" && "$MEETING_VER2" != "$MEETING_VER" && "$PATCH_ATTENDEES" == "1" && "$PATCH_EMAIL" == "only@meetings-proof.test" ]] \
	|| die "meeting patch: ${patch_meeting}"
log "patched v${MEETING_VER2}"

log "PATCH meeting status=completed → timeline meeting.completed"
complete_code="$(
	curl -sS --max-time 30 -o "${TMPDIR_PROOF}/complete.json" -w '%{http_code}' \
		-X PATCH "${API_BASE}/api/v1/meetings/${MEETING_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${MEETING_VER2}\"" \
		-H 'content-type: application/json' \
		-d '{"status":"completed"}'
)"
complete_body="$(cat "${TMPDIR_PROOF}/complete.json")"
[[ "$complete_code" == "200" ]] || die "meeting complete HTTP ${complete_code}: ${complete_body}"
MEETING_VER2="$(printf '%s' "$complete_body" | jq -r '.data.version // empty')"
timeline_done="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/entities/contact/${CONTACT_ID}/timeline-events?limit=20" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
DONE_COUNT="$(printf '%s' "$timeline_done" | jq -r --arg mid "$MEETING_ID" \
	'[.data[]? | select(.kind == "meeting" and (.payload.action // "") == "meeting.completed" and (.payload.meeting_id // "") == $mid)] | length')"
[[ "$DONE_COUNT" == "1" ]] || die "expected meeting.completed on contact timeline: ${timeline_done}"

log "POST related_entity_type=project with valid project → expect 201"
project_ok_code="$(
	curl -sS --max-time 30 -o "${TMPDIR_PROOF}/project-ok.json" -w '%{http_code}' \
		-X POST "${API_BASE}/api/v1/meetings" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg starts "$STARTS" --arg ends "$ENDS" --arg p "$PROJECT_ID" \
			'{title:"Project link", starts_at:$starts, ends_at:$ends,
			  related_entity_type:"project", related_entity_id:$p}')"
)"
project_ok_body="$(cat "${TMPDIR_PROOF}/project-ok.json")"
[[ "$project_ok_code" == "201" ]] || die "expected 201 for valid project related entity, got ${project_ok_code}: ${project_ok_body}"
PROJECT_LABEL="$(printf '%s' "$project_ok_body" | jq -r '.data.related_entity_label // empty')"
[[ "$PROJECT_LABEL" == "Proof project" ]] || die "project related_entity_label missing: ${project_ok_body}"

log "POST related_entity_type=project missing uuid → expect 422"
project_code="$(
	curl -sS --max-time 30 -o "${TMPDIR_PROOF}/project.json" -w '%{http_code}' \
		-X POST "${API_BASE}/api/v1/meetings" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg starts "$STARTS" --arg ends "$ENDS" \
			'{title:"Missing project", starts_at:$starts, ends_at:$ends,
			  related_entity_type:"project", related_entity_id:"11111111-1111-4111-8111-111111111111"}')"
)"
[[ "$project_code" == "422" ]] || die "expected 422 for missing project related entity, got ${project_code}: $(cat "${TMPDIR_PROOF}/project.json")"

log "PATCH stale If-Match → expect 412"
stale_code="$(
	curl -sS --max-time 30 -o "${TMPDIR_PROOF}/stale.json" -w '%{http_code}' \
		-X PATCH "${API_BASE}/api/v1/meetings/${MEETING_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${MEETING_VER}\"" \
		-H 'content-type: application/json' \
		-d '{"title":"Stale"}'
)"
[[ "$stale_code" == "412" ]] || die "expected 412 for stale If-Match, got ${stale_code}: $(cat "${TMPDIR_PROOF}/stale.json")"

log "DELETE meetings with If-Match"
del_code="$(
	curl -sS --max-time 30 -o "${TMPDIR_PROOF}/del.json" -w '%{http_code}' \
		-X DELETE "${API_BASE}/api/v1/meetings/${MEETING_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${MEETING_VER2}\""
)"
[[ "$del_code" == "204" ]] || die "expected 204 delete, got ${del_code}: $(cat "${TMPDIR_PROOF}/del.json")"

log "GET deleted meeting → 404"
gone_code="$(
	curl -sS --max-time 30 -o "${TMPDIR_PROOF}/gone.json" -w '%{http_code}' \
		"${API_BASE}/api/v1/meetings/${MEETING_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
[[ "$gone_code" == "404" ]] || die "expected 404 after delete, got ${gone_code}: $(cat "${TMPDIR_PROOF}/gone.json")"

log "PASS"

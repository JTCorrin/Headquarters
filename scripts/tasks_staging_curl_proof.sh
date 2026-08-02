#!/usr/bin/env bash
# Prove tasks CRUD, assignee=me filter, entity link, and stale If-Match
# against a live stack (JWT + X-Org-Id).
#
# Usage:
#   SUPABASE_URL=http://192.168.5.136:54321 \
#   SUPABASE_ANON_KEY=... \
#   API_BASE=http://192.168.5.136:54321/functions/v1/api-v1 \
#   ./scripts/tasks_staging_curl_proof.sh
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL is required}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"
API_BASE="${API_BASE:-${SUPABASE_URL}/functions/v1/api-v1}"
API_BASE="${API_BASE%/}"

EMAIL="${PROOF_EMAIL:-tasks-proof-$(date +%s)-$RANDOM@example.test}"
PASSWORD="${PROOF_PASSWORD:-ProofPass123!}"
SLUG="${PROOF_SLUG:-tasks-proof-$(date +%s)}"
DISPLAY_NAME="${PROOF_DISPLAY_NAME:-Tasks Curl Proof}"

log() { printf '[tasks-curl-proof] %s\n' "$*"; }
die() { printf '[tasks-curl-proof] FAIL: %s\n' "$*" >&2; exit 1; }

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
		-d "$(jq -n --arg name "Tasks Proof Org ${SLUG}" --arg slug "$SLUG" \
			'{name:$name, slug:$slug, country_code:"GB", default_currency:"GBP", locale:"en-GB"}')"
)"
ORG_ID="$(printf '%s' "$create_org" | jq -r '.data.organisation.id // empty')"
[[ -n "$ORG_ID" ]] || die "org create failed: ${create_org}"
log "org ${ORG_ID}"

MEMBERSHIP_ID="$(printf '%s' "$create_org" | jq -r '.data.membership.id // empty')"
if [[ -z "$MEMBERSHIP_ID" || "$MEMBERSHIP_ID" == null ]]; then
	# Fallback: list orgs / me if shape differs
	MEMBERSHIP_ID="$(printf '%s' "$create_org" | jq -r '
		.data.organisation.membership_id
		// .data.membership_id
		// empty
	')"
fi

log "POST contacts (entity link target)"
create_contact="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/contacts" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d '{"display_name":"Proof Contact","primary_email":"contact@tasks-proof.test"}'
)"
CONTACT_ID="$(printf '%s' "$create_contact" | jq -r '.data.id // empty')"
[[ -n "$CONTACT_ID" ]] || die "contact create: ${create_contact}"
log "contact ${CONTACT_ID}"

# Resolve membership id from organisations list if missing
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
[[ -n "$MEMBERSHIP_ID" && "$MEMBERSHIP_ID" != null ]] || die "could not resolve membership id: ${create_org}"
log "membership ${MEMBERSHIP_ID}"

log "POST tasks"
create_task="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/tasks" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg m "$MEMBERSHIP_ID" --arg c "$CONTACT_ID" \
			'{title:"Proof task", priority:"p2", status:"open",
			  assignee_membership_id:$m, entity_type:"contact", entity_id:$c}')"
)"
TASK_ID="$(printf '%s' "$create_task" | jq -r '.data.id // empty')"
TASK_VER="$(printf '%s' "$create_task" | jq -r '.data.version // empty')"
TASK_STATUS="$(printf '%s' "$create_task" | jq -r '.data.status // empty')"
TASK_PRIO="$(printf '%s' "$create_task" | jq -r '.data.priority // empty')"
TASK_ASSIGNEE="$(printf '%s' "$create_task" | jq -r '.data.assignee_membership_id // empty')"
[[ -n "$TASK_ID" && "$TASK_STATUS" == "open" && "$TASK_PRIO" == "p2" && "$TASK_ASSIGNEE" == "$MEMBERSHIP_ID" && -n "$TASK_VER" ]] \
	|| die "task create: ${create_task}"
log "task ${TASK_ID} v${TASK_VER}"

log "GET tasks?assignee=me"
list_me="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/tasks?assignee=me&status=open" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
LIST_COUNT="$(printf '%s' "$list_me" | jq -r --arg id "$TASK_ID" '[.data[]? | select(.id == $id)] | length')"
[[ "$LIST_COUNT" == "1" ]] || die "assignee=me list missing task: ${list_me}"

log "PATCH tasks (status → in_progress) with If-Match"
patch_task="$(
	curl -fsS --max-time 30 \
		-X PATCH "${API_BASE}/api/v1/tasks/${TASK_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${TASK_VER}\"" \
		-H 'content-type: application/json' \
		-d '{"status":"in_progress"}'
)"
TASK_VER2="$(printf '%s' "$patch_task" | jq -r '.data.version // empty')"
PATCH_STATUS="$(printf '%s' "$patch_task" | jq -r '.data.status // empty')"
STARTED="$(printf '%s' "$patch_task" | jq -r '.data.started_at // empty')"
[[ "$PATCH_STATUS" == "in_progress" && -n "$TASK_VER2" && "$TASK_VER2" != "$TASK_VER" && -n "$STARTED" && "$STARTED" != null ]] \
	|| die "task patch: ${patch_task}"
log "patched v${TASK_VER2}"

log "PATCH stale If-Match → expect 412"
stale_code="$(
	curl -sS --max-time 30 -o "${TMPDIR_PROOF}/stale.json" -w '%{http_code}' \
		-X PATCH "${API_BASE}/api/v1/tasks/${TASK_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${TASK_VER}\"" \
		-H 'content-type: application/json' \
		-d '{"title":"Stale"}'
)"
[[ "$stale_code" == "412" ]] || die "expected 412 for stale If-Match, got ${stale_code}: $(cat "${TMPDIR_PROOF}/stale.json")"

log "DELETE tasks with If-Match"
del_code="$(
	curl -sS --max-time 30 -o "${TMPDIR_PROOF}/del.json" -w '%{http_code}' \
		-X DELETE "${API_BASE}/api/v1/tasks/${TASK_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${TASK_VER2}\""
)"
[[ "$del_code" == "204" ]] || die "expected 204 delete, got ${del_code}: $(cat "${TMPDIR_PROOF}/del.json")"

log "GET deleted task → 404"
gone_code="$(
	curl -sS --max-time 30 -o "${TMPDIR_PROOF}/gone.json" -w '%{http_code}' \
		"${API_BASE}/api/v1/tasks/${TASK_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
[[ "$gone_code" == "404" ]] || die "expected 404 after delete, got ${gone_code}: $(cat "${TMPDIR_PROOF}/gone.json")"

log "PASS"

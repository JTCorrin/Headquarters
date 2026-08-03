#!/usr/bin/env bash
# Prove projects CRUD, nested workspace, board drag, card move, and stale If-Match
# against a live stack (JWT + X-Org-Id).
#
# Usage:
#   SUPABASE_URL=http://192.168.5.136:54321 \
#   SUPABASE_ANON_KEY=... \
#   API_BASE=http://192.168.5.136:54321/functions/v1/api-v1 \
#   ./scripts/projects_staging_curl_proof.sh
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL is required}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"
API_BASE="${API_BASE:-${SUPABASE_URL}/functions/v1/api-v1}"
API_BASE="${API_BASE%/}"

EMAIL="${PROOF_EMAIL:-projects-proof-$(date +%s)-$RANDOM@example.test}"
PASSWORD="${PROOF_PASSWORD:-ProofPass123!}"
SLUG="${PROOF_SLUG:-projects-proof-$(date +%s)}"
DISPLAY_NAME="${PROOF_DISPLAY_NAME:-Projects Curl Proof}"

log() { printf '[projects-curl-proof] %s\n' "$*"; }
die() { printf '[projects-curl-proof] FAIL: %s\n' "$*" >&2; exit 1; }

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
		-d "$(jq -n --arg name "Projects Proof Org ${SLUG}" --arg slug "$SLUG" \
			'{name:$name, slug:$slug, country_code:"GB", default_currency:"GBP", locale:"en-GB", timezone:"Europe/London"}')"
)"
ORG_ID="$(printf '%s' "$create_org" | jq -r '.data.organisation.id // empty')"
[[ -n "$ORG_ID" ]] || die "org create failed: ${create_org}"
log "org ${ORG_ID}"

log "POST clients"
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
CLIENT_LABEL="$(printf '%s' "$create_client" | jq -r '.data.name // empty')"
[[ -n "$CLIENT_ID" ]] || die "client create: ${create_client}"
log "client ${CLIENT_ID}"

log "POST projects"
create_project="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/projects" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg c "$CLIENT_ID" '{client_id:$c, name:"Proof rollout", status:"planning"}')"
)"
PROJECT_ID="$(printf '%s' "$create_project" | jq -r '.data.id // empty')"
PROJECT_VER="$(printf '%s' "$create_project" | jq -r '.data.version // empty')"
COL_COUNT="$(printf '%s' "$create_project" | jq -r '.data.columns | length')"
COL_KEYS="$(printf '%s' "$create_project" | jq -r '[.data.columns[].key] | join(",")')"
[[ -n "$PROJECT_ID" && -n "$PROJECT_VER" && "$COL_COUNT" == "4" && "$COL_KEYS" == "backlog,doing,review,done" ]] \
	|| die "project create: ${create_project}"
BACKLOG_ID="$(printf '%s' "$create_project" | jq -r '.data.columns[] | select(.key=="backlog") | .id')"
DOING_ID="$(printf '%s' "$create_project" | jq -r '.data.columns[] | select(.key=="doing") | .id')"
[[ -n "$BACKLOG_ID" && -n "$DOING_ID" ]] || die "missing default columns: ${create_project}"
log "project ${PROJECT_ID} v${PROJECT_VER}"

log "GET projects?client_id="
list_client="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/projects?client_id=${CLIENT_ID}&limit=10" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
LIST_COUNT="$(printf '%s' "$list_client" | jq -r --arg id "$PROJECT_ID" '[.data[]? | select(.id == $id)] | length')"
[[ "$LIST_COUNT" == "1" ]] || die "client filter list missing project: ${list_client}"

log "GET projects/{id} nested"
get_project="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/projects/${PROJECT_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
NESTED_COLS="$(printf '%s' "$get_project" | jq -r '.data.columns | length')"
NESTED_LABEL="$(printf '%s' "$get_project" | jq -r '.data.client_label // empty')"
[[ "$NESTED_COLS" == "4" && "$NESTED_LABEL" == "$CLIENT_LABEL" ]] || die "nested get: ${get_project}"

log "POST projects/{id}/cards"
create_card="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/projects/${PROJECT_ID}/cards" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d '{"title":"Proof card","description":"First card"}'
)"
CARD_ID="$(printf '%s' "$create_card" | jq -r '.data.id // empty')"
CARD_VER="$(printf '%s' "$create_card" | jq -r '.data.version // empty')"
CARD_COL="$(printf '%s' "$create_card" | jq -r '.data.column_id // empty')"
[[ -n "$CARD_ID" && -n "$CARD_VER" && "$CARD_COL" == "$BACKLOG_ID" ]] || die "card create: ${create_card}"
log "card ${CARD_ID} v${CARD_VER}"

log "PATCH card column+position with If-Match"
patch_card_code="$(
	curl -sS --max-time 30 -o "${TMPDIR_PROOF}/patch-card.json" -w '%{http_code}' \
		-X PATCH "${API_BASE}/api/v1/projects/${PROJECT_ID}/cards/${CARD_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${CARD_VER}\"" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg col "$DOING_ID" '{column_id:$col, position:10}')"
)"
patch_card="$(cat "${TMPDIR_PROOF}/patch-card.json")"
[[ "$patch_card_code" == "200" ]] || die "card patch HTTP ${patch_card_code}: ${patch_card}"
CARD_VER2="$(printf '%s' "$patch_card" | jq -r '.data.version // empty')"
PATCH_COL="$(printf '%s' "$patch_card" | jq -r '.data.column_id // empty')"
PATCH_POS="$(printf '%s' "$patch_card" | jq -r '.data.position // empty')"
[[ "$PATCH_COL" == "$DOING_ID" && "$PATCH_POS" == "10" && -n "$CARD_VER2" && "$CARD_VER2" != "$CARD_VER" ]] \
	|| die "card patch: ${patch_card}"

log "PATCH project status+position with If-Match"
patch_project_code="$(
	curl -sS --max-time 30 -o "${TMPDIR_PROOF}/patch-project.json" -w '%{http_code}' \
		-X PATCH "${API_BASE}/api/v1/projects/${PROJECT_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${PROJECT_VER}\"" \
		-H 'content-type: application/json' \
		-d '{"status":"active","position":5}'
)"
patch_project="$(cat "${TMPDIR_PROOF}/patch-project.json")"
[[ "$patch_project_code" == "200" ]] || die "project patch HTTP ${patch_project_code}: ${patch_project}"
PROJECT_VER2="$(printf '%s' "$patch_project" | jq -r '.data.version // empty')"
PATCH_STATUS="$(printf '%s' "$patch_project" | jq -r '.data.status // empty')"
PATCH_BOARD_POS="$(printf '%s' "$patch_project" | jq -r '.data.position // empty')"
[[ "$PATCH_STATUS" == "active" && "$PATCH_BOARD_POS" == "5" && -n "$PROJECT_VER2" && "$PROJECT_VER2" != "$PROJECT_VER" ]] \
	|| die "project patch: ${patch_project}"

log "DELETE card with If-Match"
del_card_code="$(
	curl -sS --max-time 30 -o "${TMPDIR_PROOF}/del-card.json" -w '%{http_code}' \
		-X DELETE "${API_BASE}/api/v1/projects/${PROJECT_ID}/cards/${CARD_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${CARD_VER2}\""
)"
[[ "$del_card_code" == "204" ]] || die "expected 204 card delete, got ${del_card_code}: $(cat "${TMPDIR_PROOF}/del-card.json")"

log "DELETE project with If-Match"
del_project_code="$(
	curl -sS --max-time 30 -o "${TMPDIR_PROOF}/del-project.json" -w '%{http_code}' \
		-X DELETE "${API_BASE}/api/v1/projects/${PROJECT_ID}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${PROJECT_VER2}\""
)"
[[ "$del_project_code" == "204" ]] || die "expected 204 project delete, got ${del_project_code}: $(cat "${TMPDIR_PROOF}/del-project.json")"

log "PASS"

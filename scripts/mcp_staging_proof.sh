#!/usr/bin/env bash
# Prove MCP: mint crm_key_ → tools/list → create_task → add_timeline_note
# → create/update contact + create lead (Wave A entity writes).
#
# Usage:
#   SUPABASE_URL=http://192.168.5.136:54321 \
#   SUPABASE_ANON_KEY=... \
#   API_BASE=http://192.168.5.136:54321/functions/v1/api-v1 \
#   ./scripts/mcp_staging_proof.sh
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL is required}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"
API_BASE="${API_BASE:-${SUPABASE_URL}/functions/v1/api-v1}"
API_BASE="${API_BASE%/}"

EMAIL="${PROOF_EMAIL:-mcp-proof-$(date +%s)-$RANDOM@example.test}"
PASSWORD="${PROOF_PASSWORD:-ProofPass123!}"
SLUG="${PROOF_SLUG:-mcp-proof-$(date +%s)}"
DISPLAY_NAME="${PROOF_DISPLAY_NAME:-MCP Curl Proof}"

log() { printf '[mcp-curl-proof] %s\n' "$*"; }
die() { printf '[mcp-curl-proof] FAIL: %s\n' "$*" >&2; exit 1; }

api_jwt() {
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

mcp() {
	local body="$1"
	shift
	curl -sS --max-time 45 -X POST "${API_BASE}/api/v1/mcp" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${CRM_KEY}" \
		-H 'content-type: application/json' \
		-H "Mcp-Method: $(printf '%s' "$body" | jq -r '.method')" \
		-d "$body" \
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
		-d "$(jq -n --arg name "MCP Proof Org ${SLUG}" --arg slug "$SLUG" \
			'{name:$name, slug:$slug, country_code:"GB", default_currency:"GBP", locale:"en-GB"}')"
)"
ORG_ID="$(printf '%s' "$create_org" | jq -r '.data.organisation.id // empty')"
[[ -n "$ORG_ID" ]] || die "org create failed: ${create_org}"

log "POST contact (JWT)"
contact_json="$(
	api_jwt POST /api/v1/contacts --data "$(jq -n \
		'{display_name:"MCP Probe Contact", first_name:"MCP", last_name:"Probe"}')"
)"
CONTACT_ID="$(printf '%s' "$contact_json" | jq -r '.data.id // empty')"
[[ -n "$CONTACT_ID" ]] || die "contact create failed: ${contact_json}"

log "POST /api/v1/api-keys (JWT owner)"
create_key="$(
	api_jwt POST /api/v1/api-keys --data "$(jq -n \
		'{name:"MCP proof key", role:"member"}')"
)"
CRM_KEY="$(printf '%s' "$create_key" | jq -r '.data.secret // empty')"
[[ -n "$CRM_KEY" ]] || die "api key create failed: ${create_key}"

log "MCP initialize"
init_json="$(
	mcp "$(jq -n '{jsonrpc:"2.0", id:1, method:"initialize", params:{protocolVersion:"2025-03-26", capabilities:{}, clientInfo:{name:"mcp-proof", version:"1.0.0"}}}')"
)"
printf '%s' "$init_json" | jq -e '.result.serverInfo.name == "headquarters-crm"' >/dev/null \
	|| die "initialize failed: ${init_json}"

log "MCP tools/list"
list_json="$(mcp "$(jq -n '{jsonrpc:"2.0", id:2, method:"tools/list"}')")"
printf '%s' "$list_json" | jq -e '
	[.result.tools[].name] | index("create_task") != null
	and index("add_timeline_note") != null
	and index("list_contacts") != null
	and index("create_contact") != null
	and index("update_contact") != null
	and index("create_lead") != null
	and index("update_lead") != null
	and index("create_client") != null
	and index("update_client") != null
' >/dev/null || die "tools/list missing Wave A tools: ${list_json}"

log "MCP tools/call create_task"
create_task_json="$(
	mcp "$(jq -n \
		--arg title "MCP proof task $(date +%s)" \
		'{jsonrpc:"2.0", id:3, method:"tools/call",
			params:{name:"create_task", arguments:{title:$title, priority:"p2", source:"agent"}}}')"
)"
TASK_ID="$(
	printf '%s' "$create_task_json" | jq -r '
		.result.structuredContent.data.id
		// (.result.content[0].text | fromjson | .data.id)
		// empty'
)"
[[ -n "$TASK_ID" && "$TASK_ID" != null ]] || die "create_task failed: ${create_task_json}"
printf '%s' "$create_task_json" | jq -e '.result.isError != true' >/dev/null \
	|| die "create_task isError: ${create_task_json}"

log "MCP tools/call add_timeline_note"
note_json="$(
	mcp "$(jq -n \
		--arg eid "$CONTACT_ID" \
		'{jsonrpc:"2.0", id:4, method:"tools/call",
			params:{name:"add_timeline_note",
				arguments:{entity_type:"contact", entity_id:$eid, title:"MCP note", body:"from proof"}}}')"
)"
NOTE_ID="$(
	printf '%s' "$note_json" | jq -r '
		.result.structuredContent.data.id
		// (.result.content[0].text | fromjson | .data.id)
		// empty'
)"
[[ -n "$NOTE_ID" && "$NOTE_ID" != null ]] || die "add_timeline_note failed: ${note_json}"
printf '%s' "$note_json" | jq -e '
	(.result.structuredContent.data.actor_type
		// (.result.content[0].text | fromjson | .data.actor_type)) == "api_key"
' >/dev/null || die "timeline actor_type not api_key: ${note_json}"

log "MCP tools/call create_contact"
create_contact_json="$(
	mcp "$(jq -n \
		--arg name "MCP Wave A Contact $(date +%s)" \
		'{jsonrpc:"2.0", id:5, method:"tools/call",
			params:{name:"create_contact",
				arguments:{display_name:$name, first_name:"Wave", last_name:"A"}}}')"
)"
MCP_CONTACT_ID="$(
	printf '%s' "$create_contact_json" | jq -r '
		.result.structuredContent.data.id
		// (.result.content[0].text | fromjson | .data.id)
		// empty'
)"
MCP_CONTACT_VER="$(
	printf '%s' "$create_contact_json" | jq -r '
		.result.structuredContent.data.version
		// (.result.content[0].text | fromjson | .data.version)
		// empty'
)"
[[ -n "$MCP_CONTACT_ID" && "$MCP_CONTACT_ID" != null ]] \
	|| die "create_contact failed: ${create_contact_json}"
[[ -n "$MCP_CONTACT_VER" && "$MCP_CONTACT_VER" != null ]] \
	|| die "create_contact missing version: ${create_contact_json}"
printf '%s' "$create_contact_json" | jq -e '.result.isError != true' >/dev/null \
	|| die "create_contact isError: ${create_contact_json}"

log "MCP tools/call update_contact"
update_contact_json="$(
	mcp "$(jq -n \
		--arg id "$MCP_CONTACT_ID" \
		--argjson ver "$MCP_CONTACT_VER" \
		'{jsonrpc:"2.0", id:6, method:"tools/call",
			params:{name:"update_contact",
				arguments:{id:$id, version:$ver, notes:"wave-a proof update"}}}')"
)"
UPD_CONTACT_VER="$(
	printf '%s' "$update_contact_json" | jq -r '
		.result.structuredContent.data.version
		// (.result.content[0].text | fromjson | .data.version)
		// empty'
)"
printf '%s' "$update_contact_json" | jq -e '.result.isError != true' >/dev/null \
	|| die "update_contact isError: ${update_contact_json}"
[[ "$UPD_CONTACT_VER" -gt "$MCP_CONTACT_VER" ]] \
	|| die "update_contact version not bumped: ${update_contact_json}"

log "MCP tools/call create_lead"
create_lead_json="$(
	mcp "$(jq -n \
		--arg name "MCP Wave A Lead $(date +%s)" \
		--arg cid "$MCP_CONTACT_ID" \
		'{jsonrpc:"2.0", id:7, method:"tools/call",
			params:{name:"create_lead",
				arguments:{name:$name, stage:"new", contact_id:$cid}}}')"
)"
LEAD_ID="$(
	printf '%s' "$create_lead_json" | jq -r '
		.result.structuredContent.data.id
		// (.result.content[0].text | fromjson | .data.id)
		// empty'
)"
[[ -n "$LEAD_ID" && "$LEAD_ID" != null ]] || die "create_lead failed: ${create_lead_json}"
printf '%s' "$create_lead_json" | jq -e '.result.isError != true' >/dev/null \
	|| die "create_lead isError: ${create_lead_json}"

log "JWT rejected on /api/v1/mcp (expect 403)"
jwt_mcp_status="$(
	curl -sS --max-time 45 -o /tmp/mcp-jwt.json -w '%{http_code}' \
		-X POST "${API_BASE}/api/v1/mcp" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d '{"jsonrpc":"2.0","id":9,"method":"tools/list"}'
)"
[[ "$jwt_mcp_status" == "403" ]] || die "expected 403 for JWT MCP, got ${jwt_mcp_status}: $(cat /tmp/mcp-jwt.json)"

log "PASS mcp initialize/list/create_task/add_timeline_note/create_update_contact/create_lead proof"

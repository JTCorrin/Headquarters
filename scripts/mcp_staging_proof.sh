#!/usr/bin/env bash
# Prove MCP: mint crm_key_ → tools/list → create_task → add_timeline_note
# → create/update contact + create lead (Wave A)
# → create project + create meeting (Wave B).
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
MEMBERSHIP_ID="$(printf '%s' "$create_org" | jq -r '.data.membership.id // empty')"
if [[ -z "$MEMBERSHIP_ID" || "$MEMBERSHIP_ID" == null ]]; then
	MEMBERSHIP_ID="$(printf '%s' "$create_org" | jq -r '
		.data.organisation.membership_id
		// .data.membership_id
		// empty')"
fi
if [[ -z "$MEMBERSHIP_ID" || "$MEMBERSHIP_ID" == null ]]; then
	orgs_json="$(
		curl -fsS --max-time 30 \
			-X GET "${API_BASE}/api/v1/organisations" \
			-H "apikey: ${SUPABASE_ANON_KEY}" \
			-H "Authorization: Bearer ${ACCESS_TOKEN}" \
			-H 'content-type: application/json'
	)"
	MEMBERSHIP_ID="$(printf '%s' "$orgs_json" | jq -r --arg oid "$ORG_ID" '
		[.data[]? | select(.organisation.id == $oid or .id == $oid) | .membership.id // .membership_id][0] // empty
	')"
fi
[[ -n "$MEMBERSHIP_ID" && "$MEMBERSHIP_ID" != null ]] \
	|| die "could not resolve membership id: ${create_org}"
log "membership ${MEMBERSHIP_ID}"

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
	and index("list_projects") != null
	and index("create_project") != null
	and index("update_project") != null
	and index("list_meetings") != null
	and index("create_meeting") != null
	and index("update_meeting") != null
	and index("list_quotes") != null
	and index("create_quote") != null
	and index("update_quote") != null
	and index("send_quote") != null
	and index("accept_quote") != null
	and index("reject_quote") != null
	and index("list_invoices") != null
	and index("create_invoice") != null
	and index("update_invoice") != null
	and index("send_invoice") != null
	and index("void_invoice") != null
	and index("create_invoice_from_quote") != null
	and index("list_payments") != null
	and index("get_payment") != null
	and index("create_payment") != null
	and index("allocate_payment") != null
	and index("reverse_payment") != null
' >/dev/null || die "tools/list missing Wave A/B/C tools: ${list_json}"

log "MCP tools/call create_task without assignee (expect error)"
create_task_missing_json="$(
	mcp "$(jq -n \
		--arg title "MCP unassigned should fail $(date +%s)" \
		'{jsonrpc:"2.0", id:30, method:"tools/call",
			params:{name:"create_task", arguments:{title:$title, priority:"p2", source:"agent"}}}')"
)"
printf '%s' "$create_task_missing_json" | jq -e '
	(.error != null)
	or (.result.isError == true)
	or ((.result.structuredContent.error // .result.content[0].text) | tostring | test("assignee_membership_id"; "i"))
' >/dev/null || die "create_task without assignee should fail: ${create_task_missing_json}"

log "MCP tools/call create_task"
create_task_json="$(
	mcp "$(jq -n \
		--arg title "MCP proof task $(date +%s)" \
		--arg mid "$MEMBERSHIP_ID" \
		'{jsonrpc:"2.0", id:3, method:"tools/call",
			params:{name:"create_task",
				arguments:{title:$title, priority:"p2", source:"agent", assignee_membership_id:$mid}}}')"
)"
TASK_ID="$(
	printf '%s' "$create_task_json" | jq -r '
		.result.structuredContent.data.id
		// (.result.content[0].text | fromjson | .data.id)
		// empty'
)"
TASK_ASSIGNEE="$(
	printf '%s' "$create_task_json" | jq -r '
		.result.structuredContent.data.assignee_membership_id
		// (.result.content[0].text | fromjson | .data.assignee_membership_id)
		// empty'
)"
[[ -n "$TASK_ID" && "$TASK_ID" != null ]] || die "create_task failed: ${create_task_json}"
printf '%s' "$create_task_json" | jq -e '.result.isError != true' >/dev/null \
	|| die "create_task isError: ${create_task_json}"
[[ "$TASK_ASSIGNEE" == "$MEMBERSHIP_ID" ]] \
	|| die "create_task assignee mismatch: ${create_task_json}"

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

log "MCP tools/call create_client (for project)"
create_client_json="$(
	mcp "$(jq -n \
		--arg name "MCP Wave B Client $(date +%s)" \
		'{jsonrpc:"2.0", id:8, method:"tools/call",
			params:{name:"create_client", arguments:{name:$name, status:"active"}}}')"
)"
CLIENT_ID="$(
	printf '%s' "$create_client_json" | jq -r '
		.result.structuredContent.data.id
		// (.result.content[0].text | fromjson | .data.id)
		// empty'
)"
[[ -n "$CLIENT_ID" && "$CLIENT_ID" != null ]] || die "create_client failed: ${create_client_json}"
printf '%s' "$create_client_json" | jq -e '.result.isError != true' >/dev/null \
	|| die "create_client isError: ${create_client_json}"

log "MCP tools/call create_project"
create_project_json="$(
	mcp "$(jq -n \
		--arg name "MCP Wave B Project $(date +%s)" \
		--arg cid "$CLIENT_ID" \
		'{jsonrpc:"2.0", id:10, method:"tools/call",
			params:{name:"create_project",
				arguments:{client_id:$cid, name:$name, status:"active"}}}')"
)"
PROJECT_ID="$(
	printf '%s' "$create_project_json" | jq -r '
		.result.structuredContent.data.id
		// (.result.content[0].text | fromjson | .data.id)
		// empty'
)"
PROJECT_VER="$(
	printf '%s' "$create_project_json" | jq -r '
		.result.structuredContent.data.version
		// (.result.content[0].text | fromjson | .data.version)
		// empty'
)"
[[ -n "$PROJECT_ID" && "$PROJECT_ID" != null ]] || die "create_project failed: ${create_project_json}"
[[ -n "$PROJECT_VER" && "$PROJECT_VER" != null ]] \
	|| die "create_project missing version: ${create_project_json}"
printf '%s' "$create_project_json" | jq -e '.result.isError != true' >/dev/null \
	|| die "create_project isError: ${create_project_json}"

log "MCP tools/call update_project"
update_project_json="$(
	mcp "$(jq -n \
		--arg id "$PROJECT_ID" \
		--argjson ver "$PROJECT_VER" \
		'{jsonrpc:"2.0", id:11, method:"tools/call",
			params:{name:"update_project",
				arguments:{id:$id, version:$ver, description:"wave-b proof update"}}}')"
)"
printf '%s' "$update_project_json" | jq -e '.result.isError != true' >/dev/null \
	|| die "update_project isError: ${update_project_json}"

log "MCP tools/call create_meeting"
STARTS="$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || date -u -v+1H +%Y-%m-%dT%H:%M:%S.000Z)"
ENDS="$(date -u -d '+2 hours' +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || date -u -v+2H +%Y-%m-%dT%H:%M:%S.000Z)"
create_meeting_json="$(
	mcp "$(jq -n \
		--arg title "MCP Wave B Meeting $(date +%s)" \
		--arg starts "$STARTS" \
		--arg ends "$ENDS" \
		--arg pid "$PROJECT_ID" \
		'{jsonrpc:"2.0", id:12, method:"tools/call",
			params:{name:"create_meeting",
				arguments:{
					title:$title,
					starts_at:$starts,
					ends_at:$ends,
					timezone:"UTC",
					related_entity_type:"project",
					related_entity_id:$pid
				}}}')"
)"
MEETING_ID="$(
	printf '%s' "$create_meeting_json" | jq -r '
		.result.structuredContent.data.id
		// (.result.content[0].text | fromjson | .data.id)
		// empty'
)"
[[ -n "$MEETING_ID" && "$MEETING_ID" != null ]] || die "create_meeting failed: ${create_meeting_json}"
printf '%s' "$create_meeting_json" | jq -e '.result.isError != true' >/dev/null \
	|| die "create_meeting isError: ${create_meeting_json}"

log "MCP tools/call create_quote (draft)"
create_quote_json="$(
	mcp "$(jq -n \
		--arg title "MCP Wave C Quote $(date +%s)" \
		--arg cid "$CLIENT_ID" \
		'{jsonrpc:"2.0", id:13, method:"tools/call",
			params:{name:"create_quote",
				arguments:{
					title:$title,
					client_id:$cid,
					lines:[{description:"Wave C line", quantity:1, unit_price_cents:5000, tax_rate_percent:0}]
				}}}')"
)"
QUOTE_ID="$(
	printf '%s' "$create_quote_json" | jq -r '
		.result.structuredContent.data.id
		// (.result.content[0].text | fromjson | .data.id)
		// empty'
)"
QUOTE_VER="$(
	printf '%s' "$create_quote_json" | jq -r '
		.result.structuredContent.data.version
		// (.result.content[0].text | fromjson | .data.version)
		// empty'
)"
[[ -n "$QUOTE_ID" && "$QUOTE_ID" != null ]] || die "create_quote failed: ${create_quote_json}"
[[ -n "$QUOTE_VER" && "$QUOTE_VER" != null ]] \
	|| die "create_quote missing version: ${create_quote_json}"
printf '%s' "$create_quote_json" | jq -e '.result.isError != true' >/dev/null \
	|| die "create_quote isError: ${create_quote_json}"

log "MCP tools/call update_quote (draft)"
update_quote_json="$(
	mcp "$(jq -n \
		--arg id "$QUOTE_ID" \
		--argjson ver "$QUOTE_VER" \
		'{jsonrpc:"2.0", id:14, method:"tools/call",
			params:{name:"update_quote",
				arguments:{id:$id, version:$ver, notes:"wave-c proof update"}}}')"
)"
printf '%s' "$update_quote_json" | jq -e '.result.isError != true' >/dev/null \
	|| die "update_quote isError: ${update_quote_json}"
QUOTE_VER="$(
	printf '%s' "$update_quote_json" | jq -r '
		.result.structuredContent.data.version
		// (.result.content[0].text | fromjson | .data.version)
		// empty'
)"
[[ -n "$QUOTE_VER" && "$QUOTE_VER" != null ]] \
	|| die "update_quote missing version: ${update_quote_json}"

log "MCP tools/call send_quote"
send_quote_json="$(
	mcp "$(jq -n \
		--arg id "$QUOTE_ID" \
		--argjson ver "$QUOTE_VER" \
		'{jsonrpc:"2.0", id:17, method:"tools/call",
			params:{name:"send_quote", arguments:{id:$id, version:$ver}}}')"
)"
printf '%s' "$send_quote_json" | jq -e '
	.result.isError != true
	and (
		(.result.structuredContent.data.status == "sent")
		or ((.result.content[0].text | fromjson | .data.status) == "sent")
	)
' >/dev/null || die "send_quote failed: ${send_quote_json}"
QUOTE_VER="$(
	printf '%s' "$send_quote_json" | jq -r '
		.result.structuredContent.data.version
		// (.result.content[0].text | fromjson | .data.version)
		// empty'
)"

log "MCP tools/call create_invoice (draft)"
create_invoice_json="$(
	mcp "$(jq -n \
		--arg cid "$CLIENT_ID" \
		'{jsonrpc:"2.0", id:15, method:"tools/call",
			params:{name:"create_invoice",
				arguments:{
					client_id:$cid,
					lines:[{description:"Wave C invoice line", quantity:1, unit_price_cents:7500, tax_rate_percent:0}]
				}}}')"
)"
INVOICE_ID="$(
	printf '%s' "$create_invoice_json" | jq -r '
		.result.structuredContent.data.id
		// (.result.content[0].text | fromjson | .data.id)
		// empty'
)"
INVOICE_VER="$(
	printf '%s' "$create_invoice_json" | jq -r '
		.result.structuredContent.data.version
		// (.result.content[0].text | fromjson | .data.version)
		// empty'
)"
[[ -n "$INVOICE_ID" && "$INVOICE_ID" != null ]] \
	|| die "create_invoice failed: ${create_invoice_json}"
[[ -n "$INVOICE_VER" && "$INVOICE_VER" != null ]] \
	|| die "create_invoice missing version: ${create_invoice_json}"
printf '%s' "$create_invoice_json" | jq -e '.result.isError != true' >/dev/null \
	|| die "create_invoice isError: ${create_invoice_json}"

log "MCP tools/call update_invoice (draft)"
update_invoice_json="$(
	mcp "$(jq -n \
		--arg id "$INVOICE_ID" \
		--argjson ver "$INVOICE_VER" \
		'{jsonrpc:"2.0", id:16, method:"tools/call",
			params:{name:"update_invoice",
				arguments:{id:$id, version:$ver, notes:"wave-c proof update"}}}')"
)"
printf '%s' "$update_invoice_json" | jq -e '.result.isError != true' >/dev/null \
	|| die "update_invoice isError: ${update_invoice_json}"
INVOICE_VER="$(
	printf '%s' "$update_invoice_json" | jq -r '
		.result.structuredContent.data.version
		// (.result.content[0].text | fromjson | .data.version)
		// empty'
)"
[[ -n "$INVOICE_VER" && "$INVOICE_VER" != null ]] \
	|| die "update_invoice missing version: ${update_invoice_json}"

log "MCP tools/call send_invoice"
send_invoice_json="$(
	mcp "$(jq -n \
		--arg id "$INVOICE_ID" \
		--argjson ver "$INVOICE_VER" \
		'{jsonrpc:"2.0", id:18, method:"tools/call",
			params:{name:"send_invoice", arguments:{id:$id, version:$ver}}}')"
)"
printf '%s' "$send_invoice_json" | jq -e '
	.result.isError != true
	and (
		(.result.structuredContent.data.status == "sent")
		or ((.result.content[0].text | fromjson | .data.status) == "sent")
	)
' >/dev/null || die "send_invoice failed: ${send_invoice_json}"

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

log "PASS mcp Wave A+B proof (contacts/leads/clients + project/meeting writes)"

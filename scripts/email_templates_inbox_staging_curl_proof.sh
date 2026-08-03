#!/usr/bin/env bash
# Prove email_templates CRUD + GET /api/v1/me/email-messages (empty personal inbox).
#
# Usage:
#   SUPABASE_URL=http://192.168.5.136:54321 \
#   SUPABASE_ANON_KEY=... \
#   API_BASE=http://192.168.5.136:54321/functions/v1/api-v1 \
#   ./scripts/email_templates_inbox_staging_curl_proof.sh
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL is required}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"
API_BASE="${API_BASE:-${SUPABASE_URL}/functions/v1/api-v1}"
API_BASE="${API_BASE%/}"

EMAIL="${PROOF_EMAIL:-email-tpl-proof-$(date +%s)-$RANDOM@example.test}"
PASSWORD="${PROOF_PASSWORD:-ProofPass123!}"
SLUG="${PROOF_SLUG:-email-tpl-proof-$(date +%s)}"
DISPLAY_NAME="${PROOF_DISPLAY_NAME:-Email Templates Curl Proof}"

log() { printf '[email-tpl-curl-proof] %s\n' "$*"; }
die() { printf '[email-tpl-curl-proof] FAIL: %s\n' "$*" >&2; exit 1; }

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
		-d "$(jq -n --arg name "Email Tpl Proof Org ${SLUG}" --arg slug "$SLUG" \
			'{name:$name, slug:$slug, country_code:"GB", default_currency:"GBP", locale:"en-GB"}')"
)"
ORG_ID="$(printf '%s' "$create_org" | jq -r '.data.organisation.id // empty')"
[[ -n "$ORG_ID" ]] || die "org create failed: ${create_org}"
log "org ${ORG_ID}"

H=(-H "apikey: ${SUPABASE_ANON_KEY}" -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "X-Org-Id: ${ORG_ID}")

log "GET me/email-messages (expect empty)"
inbox="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/me/email-messages" \
		"${H[@]}"
)"
printf '%s' "$inbox" | jq -e '.data | type == "array" and length == 0' >/dev/null \
	|| die "empty inbox expected: ${inbox}"

log "GET email-templates (expect empty)"
list_tpl="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/email-templates" \
		"${H[@]}"
)"
printf '%s' "$list_tpl" | jq -e '.data | type == "array" and length == 0' >/dev/null \
	|| die "empty templates list: ${list_tpl}"

log "POST email-templates"
create_tpl="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/email-templates" \
		"${H[@]}" \
		-H 'content-type: application/json' \
		-d '{
			"name": "Chase overdue",
			"subject": "Invoice reminder",
			"body_text": "Please pay invoice {{number}}",
			"category": "chase",
			"status": "active",
			"merge_schema": ["number"]
		}'
)"
TPL_ID="$(printf '%s' "$create_tpl" | jq -r '.data.id // empty')"
TPL_VER="$(printf '%s' "$create_tpl" | jq -r '.data.version // empty')"
TPL_STATUS="$(printf '%s' "$create_tpl" | jq -r '.data.status // empty')"
[[ -n "$TPL_ID" && "$TPL_STATUS" == "active" && -n "$TPL_VER" ]] \
	|| die "template create: ${create_tpl}"
log "template ${TPL_ID} v${TPL_VER}"

log "GET email-templates/:id"
get_tpl="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/email-templates/${TPL_ID}" \
		"${H[@]}"
)"
printf '%s' "$get_tpl" | jq -e --arg id "$TPL_ID" \
	'.data.id == $id and .data.category == "chase"' >/dev/null \
	|| die "template get: ${get_tpl}"

log "PATCH email-templates/:id"
patch_tpl="$(
	curl -fsS --max-time 30 \
		-X PATCH "${API_BASE}/api/v1/email-templates/${TPL_ID}" \
		"${H[@]}" \
		-H "If-Match: \"${TPL_VER}\"" \
		-H 'content-type: application/json' \
		-d '{"subject":"Friendly reminder","status":"draft"}'
)"
TPL_VER="$(printf '%s' "$patch_tpl" | jq -r '.data.version // empty')"
SUBJ="$(printf '%s' "$patch_tpl" | jq -r '.data.subject // empty')"
[[ "$SUBJ" == "Friendly reminder" && -n "$TPL_VER" ]] || die "template patch: ${patch_tpl}"

log "PATCH stale If-Match (expect 412)"
stale_code="$(
	curl -sS --max-time 30 -o "${TMPDIR_PROOF}/stale.body" -w '%{http_code}' \
		-X PATCH "${API_BASE}/api/v1/email-templates/${TPL_ID}" \
		"${H[@]}" \
		-H 'If-Match: "1"' \
		-H 'content-type: application/json' \
		-d '{"subject":"Stale"}'
)"
[[ "$stale_code" == "412" ]] || die "expected 412, got ${stale_code}: $(cat "${TMPDIR_PROOF}/stale.body")"

log "DELETE email-templates/:id"
del_code="$(
	curl -sS --max-time 30 -o "${TMPDIR_PROOF}/del.body" -w '%{http_code}' \
		-X DELETE "${API_BASE}/api/v1/email-templates/${TPL_ID}" \
		"${H[@]}" \
		-H "If-Match: \"${TPL_VER}\""
)"
[[ "$del_code" == "204" ]] || die "expected 204 delete, got ${del_code}: $(cat "${TMPDIR_PROOF}/del.body")"

list_after="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/email-templates" \
		"${H[@]}"
)"
printf '%s' "$list_after" | jq -e '.data | length == 0' >/dev/null \
	|| die "expected empty list after soft-delete: ${list_after}"

log "PASS templates CRUD + empty personal inbox"

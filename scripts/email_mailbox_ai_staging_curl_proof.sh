#!/usr/bin/env bash
# Prove Wave A+B(+B.1) mailbox + org AI against a live stack:
#   Wave A: signup → org → mailbox → test → AI×4 connect/list → disconnects
#   Wave B: sync skeleton → address_match list → share full body → draft use/discard
#           → owner-only AI write denial for admin (needs SUPABASE_SERVICE_ROLE_KEY)
#   Wave B.1: owner draft OK; second member 404 on address_match-only; OK after share
#
# Usage:
#   SUPABASE_URL=http://192.168.5.136:54321 \
#   SUPABASE_ANON_KEY=... \
#   SUPABASE_SERVICE_ROLE_KEY=... \   # optional but required for admin/share proofs
#   API_BASE=http://192.168.5.136:54321/functions/v1/api-v1 \
#   ./scripts/email_mailbox_ai_staging_curl_proof.sh
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL is required}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
API_BASE="${API_BASE:-${SUPABASE_URL}/functions/v1/api-v1}"
API_BASE="${API_BASE%/}"

EMAIL="${PROOF_EMAIL:-mailai-proof-$(date +%s)-$RANDOM@example.test}"
PASSWORD="${PROOF_PASSWORD:-ProofPass123!}"
SLUG="${PROOF_SLUG:-mailai-proof-$(date +%s)}"
DISPLAY_NAME="${PROOF_DISPLAY_NAME:-Mailbox AI Curl Proof}"
MAIL_PASSWORD="${PROOF_MAIL_PASSWORD:-mailbox-secret-$RANDOM}"
PEER_EMAIL="${PROOF_PEER_EMAIL:-peer@example.test}"

log() { printf '[mailai-curl-proof] %s\n' "$*"; }
die() { printf '[mailai-curl-proof] FAIL: %s\n' "$*" >&2; exit 1; }

assert_no_secret_echo() {
	local label="$1" json="$2"
	if printf '%s' "$json" | jq -e '
		[..]
		| objects
		| keys_unsorted[]
		| select(. == "secret_ref" or . == "password" or . == "api_key")
	' >/dev/null 2>&1; then
		die "${label}: response echoed a secret field"
	fi
	if printf '%s' "$json" | grep -Fqi -- "$MAIL_PASSWORD"; then
		die "${label}: response echoed mailbox password plaintext"
	fi
	if printf '%s' "$json" | grep -Eqi 'sk-test-openai|sk-test-anthropic|sk-test-google|sk-test-openrouter'; then
		die "${label}: response echoed an API key plaintext"
	fi
}

api() {
	local method="$1" path="$2"
	shift 2
	curl -sS --max-time 30 -X "$method" "${API_BASE}${path}" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-H "x-request-id: mailai-$(date +%s)-$RANDOM" \
		"$@"
}

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
	log "signup response missing access_token; trying password grant"
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
[[ -n "$ACCESS_TOKEN" ]] || die "no access_token after signup/password grant"
log "got JWT"

log "POST organisations"
create_json="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/organisations" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H 'content-type: application/json' \
		-d "$(jq -n \
			--arg name "Mail AI Org ${SLUG}" \
			--arg slug "$SLUG" \
			'{name:$name, slug:$slug, country_code:"GB", default_currency:"GBP", locale:"en-GB"}')"
)"
ORG_ID="$(printf '%s' "$create_json" | jq -r '.data.organisation.id // empty')"
[[ -n "$ORG_ID" ]] || die "organisation create failed: ${create_json}"
log "org ${ORG_ID}"

log "GET mailbox (expect 404 Mailbox not found — not Route not found)"
get_missing_code="$(
	curl -sS --max-time 30 -o /tmp/mailai-missing.json -w '%{http_code}' \
		-X GET "${API_BASE}/api/v1/me/mailbox" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
[[ "$get_missing_code" == "404" ]] || die "expected 404 before mailbox create, got ${get_missing_code}"
missing_msg="$(jq -r '.error.message // empty' /tmp/mailai-missing.json 2>/dev/null || true)"
[[ "$missing_msg" == "Mailbox not found" ]] \
	|| die "expected Mailbox not found before create (stale edge?), got: ${missing_msg:-$(cat /tmp/mailai-missing.json)}"

log "PUT mailbox"
put_json="$(
	api PUT /api/v1/me/mailbox --data "$(jq -n \
		--arg email "mail.${SLUG}@example.test" \
		--arg pass "$MAIL_PASSWORD" \
		'{
			email_address:$email,
			from_name:"Proof Mailer",
			imap_host:"imap.example.test",
			imap_port:993,
			imap_security:"tls",
			smtp_host:"smtp.example.test",
			smtp_port:587,
			smtp_security:"starttls",
			username:$email,
			password:$pass
		}')"
)"
printf '%s' "$put_json" | jq -e '.data.credentials_configured == true' >/dev/null \
	|| die "PUT mailbox missing credentials_configured: ${put_json}"
assert_no_secret_echo "PUT mailbox" "$put_json"

log "GET mailbox (no secret echo)"
get_json="$(api GET /api/v1/me/mailbox)"
printf '%s' "$get_json" | jq -e '.data.credentials_configured == true' >/dev/null \
	|| die "GET mailbox credentials_configured false: ${get_json}"
assert_no_secret_echo "GET mailbox" "$get_json"

log "POST mailbox/test (stored credentials)"
test_json="$(api POST /api/v1/me/mailbox/test --data '{}')"
printf '%s' "$test_json" | jq -e '.data.ok == true' >/dev/null \
	|| die "mailbox test failed: ${test_json}"
assert_no_secret_echo "POST mailbox/test" "$test_json"

log "POST contact for address_match (${PEER_EMAIL})"
contact_json="$(
	api POST /api/v1/contacts --data "$(jq -n \
		--arg email "$PEER_EMAIL" \
		'{display_name:"Mail Peer Contact", primary_email:$email}')"
)"
CONTACT_ID="$(printf '%s' "$contact_json" | jq -r '.data.id // empty')"
[[ -n "$CONTACT_ID" ]] || die "contact create failed: ${contact_json}"

log "GET contact email-messages (empty before sync)"
emails_json="$(api GET "/api/v1/contacts/${CONTACT_ID}/email-messages")"
printf '%s' "$emails_json" | jq -e '.data | type == "array" and length == 0' >/dev/null \
	|| die "entity email list expected empty array: ${emails_json}"

for provider in openai anthropic google openrouter; do
	log "PUT AI ${provider}"
	ai_json="$(
		api PUT "/api/v1/integrations/ai/${provider}" --data "$(jq -n \
			--arg key "sk-test-${provider}-$(date +%s)" \
			'{api_key:$key}')"
	)"
	printf '%s' "$ai_json" | jq -e --arg p "$provider" \
		'.data.provider == $p and .data.credentials_configured == true and .data.status == "active"' \
		>/dev/null || die "AI connect ${provider} failed: ${ai_json}"
	assert_no_secret_echo "PUT AI ${provider}" "$ai_json"
done

log "GET integrations"
list_json="$(api GET /api/v1/integrations)"
printf '%s' "$list_json" | jq -e '.data | length == 4' >/dev/null \
	|| die "expected 4 AI integrations: ${list_json}"
assert_no_secret_echo "GET integrations" "$list_json"
printf '%s' "$list_json" | jq -e '
	[.data[].provider] | sort == ["anthropic","google","openai","openrouter"]
' >/dev/null || die "unexpected provider set: ${list_json}"

# --- Wave B + B.1: sync + draft visibility + share + owner-only denial ---

log "POST mailbox/sync (synthetic imap.example.test)"
sync_json="$(api POST /api/v1/me/mailbox/sync --data '{}')"
printf '%s' "$sync_json" | jq -e '.data.ok == true and .data.ingested >= 1' >/dev/null \
	|| die "mailbox sync failed: ${sync_json}"

log "GET contact email-messages after sync (address_match, owner body)"
owner_emails="$(api GET "/api/v1/contacts/${CONTACT_ID}/email-messages")"
printf '%s' "$owner_emails" | jq -e '
	(.data | type == "array" and length >= 1)
	and (.data[0].body_text != null)
	and (.data[0].body_text | contains("Wave B sync skeleton"))
	and (.data[0].link_reason == "address_match")
' >/dev/null || die "owner address_match list missing body: ${owner_emails}"
MESSAGE_ID="$(printf '%s' "$owner_emails" | jq -r '.data[0].id // empty')"
[[ -n "$MESSAGE_ID" ]] || die "missing message id after sync"

log "POST ai-suggestions/email-reply (owner, address_match-only)"
draft_json="$(
	api POST /api/v1/ai-suggestions/email-reply --data "$(jq -n \
		--arg id "$MESSAGE_ID" \
		'{email_message_id:$id, variant:"neutral"}')"
)"
printf '%s' "$draft_json" | jq -e '
	.data.status == "ready"
	and (.data.output_text | type == "string" and length > 0)
	and .data.kind == "email_reply"
' >/dev/null || die "owner draft generate failed: ${draft_json}"
SUGGESTION_ID="$(printf '%s' "$draft_json" | jq -r '.data.id // empty')"
[[ -n "$SUGGESTION_ID" ]] || die "missing suggestion id"

if [[ -n "$SUPABASE_SERVICE_ROLE_KEY" ]]; then
	log "signup second user (admin) for B.1 draft visibility + owner-only denial"
	ADMIN_EMAIL="mailai-admin-$(date +%s)-$RANDOM@example.test"
	admin_signup="$(
		curl -fsS --max-time 30 \
			-X POST "${SUPABASE_URL}/auth/v1/signup" \
			-H "apikey: ${SUPABASE_ANON_KEY}" \
			-H 'content-type: application/json' \
			-d "$(jq -n \
				--arg email "$ADMIN_EMAIL" \
				--arg password "$PASSWORD" \
				'{email:$email, password:$password, data:{display_name:"Mail AI Admin"}}')"
	)"
	ADMIN_TOKEN="$(printf '%s' "$admin_signup" | jq -r '.access_token // empty')"
	ADMIN_UID="$(printf '%s' "$admin_signup" | jq -r '.user.id // empty')"
	if [[ -z "$ADMIN_TOKEN" || "$ADMIN_TOKEN" == null ]]; then
		admin_tok="$(
			curl -fsS --max-time 30 \
				-X POST "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
				-H "apikey: ${SUPABASE_ANON_KEY}" \
				-H 'content-type: application/json' \
				-d "$(jq -n --arg email "$ADMIN_EMAIL" --arg password "$PASSWORD" \
					'{email:$email, password:$password}')"
		)"
		ADMIN_TOKEN="$(printf '%s' "$admin_tok" | jq -r '.access_token // empty')"
		ADMIN_UID="$(printf '%s' "$admin_tok" | jq -r '.user.id // empty')"
	fi
	[[ -n "$ADMIN_TOKEN" && -n "$ADMIN_UID" ]] || die "admin signup/token failed"

	log "service-role insert admin membership"
	mem_code="$(
		curl -sS --max-time 30 -o /tmp/mailai-mem.json -w '%{http_code}' \
			-X POST "${SUPABASE_URL}/rest/v1/memberships" \
			-H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
			-H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
			-H 'content-type: application/json' \
			-H 'Prefer: return=minimal' \
			-d "$(jq -n \
				--arg org "$ORG_ID" \
				--arg uid "$ADMIN_UID" \
				'{org_id:$org, user_id:$uid, role:"admin", status:"active"}')"
	)"
	[[ "$mem_code" == "201" || "$mem_code" == "200" ]] \
		|| die "admin membership insert expected 201, got ${mem_code}: $(cat /tmp/mailai-mem.json)"

	log "admin POST ai-suggestions/email-reply on address_match-only → expect 404"
	admin_draft_denied_code="$(
		curl -sS --max-time 30 -o /tmp/mailai-admin-draft-denied.json -w '%{http_code}' \
			-X POST "${API_BASE}/api/v1/ai-suggestions/email-reply" \
			-H "apikey: ${SUPABASE_ANON_KEY}" \
			-H "Authorization: Bearer ${ADMIN_TOKEN}" \
			-H "X-Org-Id: ${ORG_ID}" \
			-H 'content-type: application/json' \
			-d "$(jq -n --arg id "$MESSAGE_ID" '{email_message_id:$id, variant:"neutral"}')"
	)"
	[[ "$admin_draft_denied_code" == "404" ]] \
		|| die "admin draft before share expected 404, got ${admin_draft_denied_code}: $(cat /tmp/mailai-admin-draft-denied.json)"
else
	log "WARN: SUPABASE_SERVICE_ROLE_KEY unset — skipped B.1 second-member draft visibility proofs"
fi

log "POST email-messages/{id}/share → timeline_share"
share_json="$(
	api POST "/api/v1/email-messages/${MESSAGE_ID}/share" --data "$(jq -n \
		--arg id "$CONTACT_ID" \
		'{entity_type:"contact", entity_id:$id}')"
)"
printf '%s' "$share_json" | jq -e '.data.timeline_event_id and .data.link_id' >/dev/null \
	|| die "share failed: ${share_json}"

if [[ -n "${ADMIN_TOKEN:-}" ]]; then
	log "admin POST ai-suggestions/email-reply after timeline_share → expect 201"
	admin_draft_ok_code="$(
		curl -sS --max-time 30 -o /tmp/mailai-admin-draft-ok.json -w '%{http_code}' \
			-X POST "${API_BASE}/api/v1/ai-suggestions/email-reply" \
			-H "apikey: ${SUPABASE_ANON_KEY}" \
			-H "Authorization: Bearer ${ADMIN_TOKEN}" \
			-H "X-Org-Id: ${ORG_ID}" \
			-H 'content-type: application/json' \
			-d "$(jq -n --arg id "$MESSAGE_ID" '{email_message_id:$id, variant:"firm"}')"
	)"
	[[ "$admin_draft_ok_code" == "201" ]] \
		|| die "admin draft after share expected 201, got ${admin_draft_ok_code}: $(cat /tmp/mailai-admin-draft-ok.json)"
	jq -e '
		.data.status == "ready"
		and (.data.output_text | type == "string" and length > 0)
	' </tmp/mailai-admin-draft-ok.json >/dev/null \
		|| die "admin draft after share missing ready output: $(cat /tmp/mailai-admin-draft-ok.json)"
fi

log "POST ai-suggestions/{id}/use (never sends)"
use_json="$(api POST "/api/v1/ai-suggestions/${SUGGESTION_ID}/use" --data '{}')"
printf '%s' "$use_json" | jq -e '.data.status == "accepted" and .data.accepted_text != null' >/dev/null \
	|| die "draft use failed: ${use_json}"

# Second suggestion for discard path
log "POST ai-suggestions/email-reply (for discard)"
draft2="$(
	api POST /api/v1/ai-suggestions/email-reply --data "$(jq -n \
		--arg id "$MESSAGE_ID" \
		'{email_message_id:$id, variant:"warm"}')"
)"
SUGGESTION2="$(printf '%s' "$draft2" | jq -r '.data.id // empty')"
[[ -n "$SUGGESTION2" ]] || die "missing second suggestion id: ${draft2}"
log "POST ai-suggestions/{id}/discard"
discard_json="$(api POST "/api/v1/ai-suggestions/${SUGGESTION2}/discard" --data '{}')"
printf '%s' "$discard_json" | jq -e '.data.status == "discarded"' >/dev/null \
	|| die "draft discard failed: ${discard_json}"

if [[ -n "${ADMIN_TOKEN:-}" ]]; then
	log "admin PUT AI openai → expect 403"
	admin_ai_code="$(
		curl -sS --max-time 30 -o /tmp/mailai-admin-ai.json -w '%{http_code}' \
			-X PUT "${API_BASE}/api/v1/integrations/ai/openai" \
			-H "apikey: ${SUPABASE_ANON_KEY}" \
			-H "Authorization: Bearer ${ADMIN_TOKEN}" \
			-H "X-Org-Id: ${ORG_ID}" \
			-H 'content-type: application/json' \
			-d '{"api_key":"sk-test-admin-should-fail"}'
	)"
	[[ "$admin_ai_code" == "403" ]] \
		|| die "admin AI write expected 403, got ${admin_ai_code}: $(cat /tmp/mailai-admin-ai.json)"

	log "admin GET organisation/configuration → expect 403"
	admin_cfg_code="$(
		curl -sS --max-time 30 -o /tmp/mailai-admin-cfg.json -w '%{http_code}' \
			-X GET "${API_BASE}/api/v1/organisation/configuration" \
			-H "apikey: ${SUPABASE_ANON_KEY}" \
			-H "Authorization: Bearer ${ADMIN_TOKEN}" \
			-H "X-Org-Id: ${ORG_ID}"
	)"
	[[ "$admin_cfg_code" == "403" ]] \
		|| die "admin org config GET expected 403, got ${admin_cfg_code}: $(cat /tmp/mailai-admin-cfg.json)"

	log "admin GET contact email-messages (shared full body)"
	admin_emails="$(
		curl -sS --max-time 30 \
			-X GET "${API_BASE}/api/v1/contacts/${CONTACT_ID}/email-messages" \
			-H "apikey: ${SUPABASE_ANON_KEY}" \
			-H "Authorization: Bearer ${ADMIN_TOKEN}" \
			-H "X-Org-Id: ${ORG_ID}"
	)"
	printf '%s' "$admin_emails" | jq -e --arg mid "$MESSAGE_ID" '
		(.data | map(select(.id == $mid)) | length) == 1
		and ((.data | map(select(.id == $mid)) | .[0].body_text) != null)
		and ((.data | map(select(.id == $mid)) | .[0].body_text) | contains("Wave B sync skeleton"))
		and ((.data | map(select(.id == $mid)) | .[0].link_reason) == "timeline_share")
	' >/dev/null || die "admin share visibility missing full body: ${admin_emails}"
fi

for provider in openai anthropic google openrouter; do
	log "DELETE AI ${provider}"
	code="$(
		curl -sS --max-time 30 -o /tmp/mailai-ai-del.json -w '%{http_code}' \
			-X DELETE "${API_BASE}/api/v1/integrations/ai/${provider}" \
			-H "apikey: ${SUPABASE_ANON_KEY}" \
			-H "Authorization: Bearer ${ACCESS_TOKEN}" \
			-H "X-Org-Id: ${ORG_ID}"
	)"
	[[ "$code" == "204" ]] || die "DELETE AI ${provider} expected 204, got ${code}"
done

log "GET integrations after disconnect"
list2="$(api GET /api/v1/integrations)"
printf '%s' "$list2" | jq -e '.data | length == 0' >/dev/null \
	|| die "expected 0 integrations after disconnect: ${list2}"

log "DELETE mailbox"
del_code="$(
	curl -sS --max-time 30 -o /tmp/mailai-del.json -w '%{http_code}' \
		-X DELETE "${API_BASE}/api/v1/me/mailbox" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
[[ "$del_code" == "204" ]] || die "DELETE mailbox expected 204, got ${del_code}"

log "GET mailbox after disconnect (expect 404)"
after_code="$(
	curl -sS --max-time 30 -o /tmp/mailai-after.json -w '%{http_code}' \
		-X GET "${API_BASE}/api/v1/me/mailbox" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
[[ "$after_code" == "404" ]] || die "expected 404 after disconnect, got ${after_code}"

log "PASS mailbox + AI Wave A+B+B.1 (sync/share/draft visibility/owner-only; no secret echo)"

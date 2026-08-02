#!/usr/bin/env bash
# Prove Wave A mailbox + org AI integrations against a live stack:
#   signup → org → PUT mailbox → GET (no secret echo) → test → AI×4 connect/list → disconnects
#
# Usage:
#   SUPABASE_URL=http://192.168.5.136:54321 \
#   SUPABASE_ANON_KEY=... \
#   API_BASE=http://192.168.5.136:54321/functions/v1/api-v1 \
#   ./scripts/email_mailbox_ai_staging_curl_proof.sh
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL is required}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"
API_BASE="${API_BASE:-${SUPABASE_URL}/functions/v1/api-v1}"
API_BASE="${API_BASE%/}"

EMAIL="${PROOF_EMAIL:-mailai-proof-$(date +%s)-$RANDOM@example.test}"
PASSWORD="${PROOF_PASSWORD:-ProofPass123!}"
SLUG="${PROOF_SLUG:-mailai-proof-$(date +%s)}"
DISPLAY_NAME="${PROOF_DISPLAY_NAME:-Mailbox AI Curl Proof}"
MAIL_PASSWORD="${PROOF_MAIL_PASSWORD:-mailbox-secret-$RANDOM}"

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

log "GET mailbox (expect 404)"
get_missing_code="$(
	curl -sS --max-time 30 -o /tmp/mailai-missing.json -w '%{http_code}' \
		-X GET "${API_BASE}/api/v1/me/mailbox" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
[[ "$get_missing_code" == "404" ]] || die "expected 404 before mailbox create, got ${get_missing_code}"

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

log "POST contact for email stub"
contact_json="$(
	api POST /api/v1/contacts --data "$(jq -n \
		'{display_name:"Mail Stub Contact", primary_email:"stub@example.test"}')"
)"
CONTACT_ID="$(printf '%s' "$contact_json" | jq -r '.data.id // empty')"
[[ -n "$CONTACT_ID" ]] || die "contact create failed: ${contact_json}"

log "GET contact email-messages stub"
emails_json="$(api GET "/api/v1/contacts/${CONTACT_ID}/email-messages")"
printf '%s' "$emails_json" | jq -e '.data | type == "array" and length == 0' >/dev/null \
	|| die "entity email stub expected empty array: ${emails_json}"

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

log "PASS mailbox + AI integrations Wave A (no secret echo)"

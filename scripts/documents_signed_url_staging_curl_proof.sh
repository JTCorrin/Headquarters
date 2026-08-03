#!/usr/bin/env bash
# Prove documents upload-intent signed_url uses the public Kong host
# (${SUPABASE_URL} / APP_HOST:54321), not the internal Docker hostname kong.
#
# Usage:
#   SUPABASE_URL=http://192.168.5.136:54321 \
#   SUPABASE_ANON_KEY=... \
#   API_BASE=http://192.168.5.136:54321/functions/v1/api-v1 \
#   ./scripts/documents_signed_url_staging_curl_proof.sh
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL is required}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"
API_BASE="${API_BASE:-${SUPABASE_URL}/functions/v1/api-v1}"
API_BASE="${API_BASE%/}"

EMAIL="${PROOF_EMAIL:-docs-signed-url-$(date +%s)-$RANDOM@example.test}"
PASSWORD="${PROOF_PASSWORD:-ProofPass123!}"
SLUG="${PROOF_SLUG:-docs-signed-url-$(date +%s)}"
DISPLAY_NAME="${PROOF_DISPLAY_NAME:-Documents Signed URL Curl Proof}"

log() { printf '[docs-signed-url-proof] %s\n' "$*"; }
die() { printf '[docs-signed-url-proof] FAIL: %s\n' "$*" >&2; exit 1; }

EXPECTED_HOST="$(printf '%s' "$SUPABASE_URL" | sed -E 's|^[a-zA-Z][a-zA-Z0-9+.-]*://||; s|/.*||')"
[[ -n "$EXPECTED_HOST" ]] || die "could not parse host from SUPABASE_URL=${SUPABASE_URL}"
log "expect signed_url host ${EXPECTED_HOST} (not kong)"

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
		-d "$(jq -n --arg name "Docs Signed URL Org ${SLUG}" --arg slug "$SLUG" \
			'{name:$name, slug:$slug, country_code:"GB", default_currency:"GBP", locale:"en-GB"}')"
)"
ORG_ID="$(printf '%s' "$create_org" | jq -r '.data.organisation.id // empty')"
[[ -n "$ORG_ID" ]] || die "org create failed: ${create_org}"
log "org ${ORG_ID}"

log "POST client (document entity)"
create_client="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/clients" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n '{
			name: "Docs Signed URL Client",
			status: "prospect",
			industry: "Software",
			primary_email: "docs-signed-url@proof-client.test"
		}')"
)"
CLIENT_ID="$(printf '%s' "$create_client" | jq -r '.data.id // empty')"
[[ -n "$CLIENT_ID" ]] || die "client create: ${create_client}"
log "client ${CLIENT_ID}"

SHA256="$(printf 'docs-signed-url-proof\n' | sha256sum | awk '{ print $1 }')"
SIZE_BYTES=22

log "POST entities/client/.../documents/upload-intent"
intent_json="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/entities/client/${CLIENT_ID}/documents/upload-intent" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n \
			--arg name "proof-upload.txt" \
			--arg sha "$SHA256" \
			--argjson size "$SIZE_BYTES" \
			'{name:$name, category:"other", mime_type:"text/plain", size_bytes:$size, sha256:$sha, folder_id:null}')"
)"
SIGNED_URL="$(printf '%s' "$intent_json" | jq -r '.data.upload.signed_url // empty')"
[[ -n "$SIGNED_URL" && "$SIGNED_URL" != null ]] || die "upload-intent missing signed_url: ${intent_json}"

SIGNED_HOST="$(printf '%s' "$SIGNED_URL" | sed -E 's|^[a-zA-Z][a-zA-Z0-9+.-]*://||; s|/.*||')"
log "signed_url host=${SIGNED_HOST}"

case "$SIGNED_HOST" in
	kong|kong:*|*:kong|*:kong:*)
		die "signed_url still points at kong (${SIGNED_URL})"
		;;
esac
if printf '%s' "$SIGNED_HOST" | grep -qiE '(^|\.)kong([:]|$)'; then
	die "signed_url still points at kong (${SIGNED_URL})"
fi
[[ "$SIGNED_HOST" == "$EXPECTED_HOST" ]] \
	|| die "signed_url host ${SIGNED_HOST} != expected ${EXPECTED_HOST} (${SIGNED_URL})"

log "ok — signed upload URL host is ${SIGNED_HOST}"

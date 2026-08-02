#!/usr/bin/env bash
# Prove recurring schedule draft CRUD, activate→pause→resume→cancel, and
# run-now → draft invoice linked by recurring_run_id.
#
# Usage:
#   SUPABASE_URL=http://192.168.5.136:54321 \
#   SUPABASE_ANON_KEY=... \
#   API_BASE=http://192.168.5.136:54321/functions/v1/api-v1 \
#   ./scripts/recurring_invoices_staging_curl_proof.sh
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL is required}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"
API_BASE="${API_BASE:-${SUPABASE_URL}/functions/v1/api-v1}"
API_BASE="${API_BASE%/}"

EMAIL="${PROOF_EMAIL:-recurring-proof-$(date +%s)-$RANDOM@example.test}"
PASSWORD="${PROOF_PASSWORD:-ProofPass123!}"
SLUG="${PROOF_SLUG:-recurring-proof-$(date +%s)}"
DISPLAY_NAME="${PROOF_DISPLAY_NAME:-Recurring Curl Proof}"
TODAY="$(date -u +%Y-%m-%d)"

log() { printf '[recurring-curl-proof] %s\n' "$*"; }
die() { printf '[recurring-curl-proof] FAIL: %s\n' "$*" >&2; exit 1; }


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
		-d "$(jq -n --arg name "Recurring Proof Org ${SLUG}" --arg slug "$SLUG" \
			'{name:$name, slug:$slug, country_code:"GB", default_currency:"GBP", locale:"en-GB"}')"
)"
ORG_ID="$(printf '%s' "$create_org" | jq -r '.data.organisation.id // empty')"
[[ -n "$ORG_ID" ]] || die "org create failed: ${create_org}"
log "org ${ORG_ID}"

log "POST client"
create_client="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/clients" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d '{"name":"Recurring Proof Client","status":"active"}'
)"
CLIENT_ID="$(printf '%s' "$create_client" | jq -r '.data.id // empty')"
[[ -n "$CLIENT_ID" ]] || die "client create: ${create_client}"
log "client ${CLIENT_ID}"

log "POST recurring schedule draft"
create_sched="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/recurring-invoice-schedules" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg client "$CLIENT_ID" --arg today "$TODAY" '{
			name: "Monthly retainer",
			client_id: $client,
			frequency: "monthly",
			day_of_month: 1,
			start_on: $today,
			anchor_on: $today,
			timezone: "UTC",
			local_run_time: "09:00:00",
			due_days: 14,
			lines: [
				{
					description_template: "Retainer {{period_start}} to {{period_end}}",
					quantity: 1,
					unit_price_cents: 420000,
					tax_rate_percent: 20,
					position: 1
				}
			]
		}')"
)"
SCHED_ID="$(printf '%s' "$create_sched" | jq -r '.data.id // empty')"
SCHED_VER="$(printf '%s' "$create_sched" | jq -r '.data.version // empty')"
SCHED_STATUS="$(printf '%s' "$create_sched" | jq -r '.data.status // empty')"
[[ -n "$SCHED_ID" && "$SCHED_STATUS" == "draft" ]] || die "schedule create: ${create_sched}"
log "schedule ${SCHED_ID} v${SCHED_VER}"

log "POST preview"
preview="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/recurring-invoice-schedules/preview" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H 'content-type: application/json' \
		-d "$(jq -n --arg client "$CLIENT_ID" --arg today "$TODAY" '{
			name: "Preview only",
			client_id: $client,
			frequency: "monthly",
			day_of_month: 1,
			start_on: $today,
			anchor_on: $today,
			lines: [{description_template:"X", quantity:1, unit_price_cents:1000}]
		}')"
)"
printf '%s' "$preview" | jq -e '.data.estimated_total_cents != null' >/dev/null \
	|| die "preview: ${preview}"

log "POST activate"
activate="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/recurring-invoice-schedules/${SCHED_ID}/activate" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${SCHED_VER}\"" \
		-H "Idempotency-Key: activate-${SCHED_ID}" \
		-H 'content-type: application/json' \
		-d '{}'
)"
SCHED_VER="$(printf '%s' "$activate" | jq -r '.data.version // empty')"
SCHED_STATUS="$(printf '%s' "$activate" | jq -r '.data.status // empty')"
NEXT_RUN="$(printf '%s' "$activate" | jq -r '.data.next_run_at // empty')"
[[ "$SCHED_STATUS" == "active" && -n "$NEXT_RUN" && "$NEXT_RUN" != null ]] \
	|| die "activate: ${activate}"
log "activated v${SCHED_VER} next_run_at=${NEXT_RUN}"

log "POST run-now"
run_now="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/recurring-invoice-schedules/${SCHED_ID}/run-now" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${SCHED_VER}\"" \
		-H "Idempotency-Key: run-now-${SCHED_ID}-1" \
		-H 'content-type: application/json' \
		-d '{}'
)"
INV_ID="$(printf '%s' "$run_now" | jq -r '.data.invoice.id // empty')"
INV_SOURCE="$(printf '%s' "$run_now" | jq -r '.data.invoice.source // empty')"
RUN_ID="$(printf '%s' "$run_now" | jq -r '.data.run.id // empty')"
REC_RUN="$(printf '%s' "$run_now" | jq -r '.data.invoice.recurring_run_id // empty')"
SCHED_VER="$(printf '%s' "$run_now" | jq -r '.data.schedule.version // .data.invoice.version // empty')"
# Prefer schedule version from response if present
if printf '%s' "$run_now" | jq -e '.data.schedule.version' >/dev/null 2>&1; then
	SCHED_VER="$(printf '%s' "$run_now" | jq -r '.data.schedule.version')"
else
	# refetch schedule for version
	get_sched="$(
		curl -fsS --max-time 30 \
			"${API_BASE}/api/v1/recurring-invoice-schedules/${SCHED_ID}" \
			-H "apikey: ${SUPABASE_ANON_KEY}" \
			-H "Authorization: Bearer ${ACCESS_TOKEN}" \
			-H "X-Org-Id: ${ORG_ID}"
	)"
	SCHED_VER="$(printf '%s' "$get_sched" | jq -r '.data.version // empty')"
fi
[[ -n "$INV_ID" && "$INV_SOURCE" == "recurring" && "$REC_RUN" == "$RUN_ID" ]] \
	|| die "run-now: ${run_now}"
log "run-now invoice ${INV_ID} run ${RUN_ID}"

log "POST run-now replay (same Idempotency-Key)"
replay="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/recurring-invoice-schedules/${SCHED_ID}/run-now" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${SCHED_VER}\"" \
		-H "Idempotency-Key: run-now-${SCHED_ID}-1" \
		-H 'content-type: application/json' \
		-d '{}'
)"
REPLAY_INV="$(printf '%s' "$replay" | jq -r '.data.invoice.id // empty')"
[[ "$REPLAY_INV" == "$INV_ID" ]] || die "run-now replay mismatch: ${replay}"

log "GET runs"
runs="$(
	curl -fsS --max-time 30 \
		"${API_BASE}/api/v1/recurring-invoice-schedules/${SCHED_ID}/runs" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}"
)"
printf '%s' "$runs" | jq -e --arg rid "$RUN_ID" '.data | map(.id) | index($rid) != null' >/dev/null \
	|| die "runs list missing run: ${runs}"

log "POST pause"
pause="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/recurring-invoice-schedules/${SCHED_ID}/pause" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${SCHED_VER}\"" \
		-H "Idempotency-Key: pause-${SCHED_ID}" \
		-H 'content-type: application/json' \
		-d '{}'
)"
SCHED_VER="$(printf '%s' "$pause" | jq -r '.data.version // empty')"
[[ "$(printf '%s' "$pause" | jq -r '.data.status')" == "paused" ]] || die "pause: ${pause}"

log "POST resume"
resume="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/recurring-invoice-schedules/${SCHED_ID}/resume" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${SCHED_VER}\"" \
		-H "Idempotency-Key: resume-${SCHED_ID}" \
		-H 'content-type: application/json' \
		-d '{}'
)"
SCHED_VER="$(printf '%s' "$resume" | jq -r '.data.version // empty')"
[[ "$(printf '%s' "$resume" | jq -r '.data.status')" == "active" ]] || die "resume: ${resume}"

log "POST cancel"
cancel="$(
	curl -fsS --max-time 30 \
		-X POST "${API_BASE}/api/v1/recurring-invoice-schedules/${SCHED_ID}/cancel" \
		-H "apikey: ${SUPABASE_ANON_KEY}" \
		-H "Authorization: Bearer ${ACCESS_TOKEN}" \
		-H "X-Org-Id: ${ORG_ID}" \
		-H "If-Match: \"${SCHED_VER}\"" \
		-H "Idempotency-Key: cancel-${SCHED_ID}" \
		-H 'content-type: application/json' \
		-d '{}'
)"
[[ "$(printf '%s' "$cancel" | jq -r '.data.status')" == "cancelled" ]] || die "cancel: ${cancel}"

log "PASS recurring invoices staging curl proof"

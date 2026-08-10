#!/usr/bin/env bash
# Remote staging deploy for Headquarters on deploy-svelte.
# Invoked over SSH by .forgejo/workflows/staging-deploy.yml — no secrets in this file.
set -euo pipefail

APP_DIR="${APP_DIR:-/home/deploy/apps/headquarters}"
REPO_URL="${REPO_URL:-https://forge.purecambo.org/joe/crm-project.git}"
BRANCH="${BRANCH:-staging}"
APP_HOST="${APP_HOST:-192.168.5.136}"
APP_PORT="${APP_PORT:-4173}"
# Same-origin SvelteKit proxy serves `/api/v1/*` on :APP_PORT. Leave empty unless
# you intentionally want the browser to call Kong/edge directly.
PUBLIC_API_BASE_URL="${PUBLIC_API_BASE_URL:-}"
STAGING_ORIGIN="http://${APP_HOST}:${APP_PORT}"
UNIT_NAME="${UNIT_NAME:-headquarters-staging}"
PNPM_VERSION="${PNPM_VERSION:-10}"

log() { printf '[staging-deploy] %s\n' "$*"; }

mkdir -p "$(dirname "$APP_DIR")"

if [[ -d "$APP_DIR/.git" ]]; then
	log "fetching ${BRANCH} in ${APP_DIR}"
	git -C "$APP_DIR" remote set-url origin "$REPO_URL"
	git -C "$APP_DIR" fetch --prune origin "$BRANCH"
	# -f: CI may have scp'd this script into the tree before invoking it.
	git -C "$APP_DIR" checkout -f -B "$BRANCH" "origin/${BRANCH}"
	git -C "$APP_DIR" reset --hard "origin/${BRANCH}"
	git -C "$APP_DIR" clean -fd
else
	# Atomic replace avoids races when CI drops scripts/ into a pre-created app dir.
	log "cloning ${REPO_URL} → ${APP_DIR}"
	mkdir -p "$(dirname "$APP_DIR")"
	new_dir="${APP_DIR}.new"
	old_dir="${APP_DIR}.old"
	rm -rf "$new_dir" "$old_dir"
	git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$new_dir"
	if [[ -f "$APP_DIR/deploy.log" ]]; then
		cp -a "$APP_DIR/deploy.log" "$new_dir/deploy.log" || true
	fi
	if [[ -d "$APP_DIR" ]]; then
		mv "$APP_DIR" "$old_dir"
	fi
	mv "$new_dir" "$APP_DIR"
	rm -rf "$old_dir"
fi

cd "$APP_DIR"
SHA="$(git rev-parse HEAD)"
log "checked out ${BRANCH} @ ${SHA}"

# Match Frontend CI lockfile tooling. Do not run `corepack enable` — on this
# Debian box `/usr/bin/pnpm` is a root-owned npm global symlink and corepack
# fails with EACCES trying to unlink it. Install a user-local pnpm instead.
PNPM_PREFIX="${HOME}/.local"
mkdir -p "${PNPM_PREFIX}/bin"
export PATH="${PNPM_PREFIX}/bin:${PATH}"
if ! pnpm --version 2>/dev/null | grep -q "^${PNPM_VERSION}\\."; then
	log "installing pnpm@${PNPM_VERSION} into ${PNPM_PREFIX}"
	npm install -g --prefix "${PNPM_PREFIX}" "pnpm@${PNPM_VERSION}"
fi
log "pnpm $(pnpm --version) / node $(node --version)"

pnpm install --frozen-lockfile

# Point Auth redirects at the LAN preview URL for this staging box.
# Keep email confirmations off so email/password signup returns a JWT for E2E.
# Use Python (not line-oriented sed): additional_redirect_urls is a multiline array
# and naive `s|^additional_redirect_urls = .*|...|` corrupts the TOML.
if [[ -f supabase/config.toml ]]; then
	STAGING_ORIGIN="${STAGING_ORIGIN}" APP_HOST="${APP_HOST}" python3 - <<'PY'
from pathlib import Path
import os
import re

path = Path("supabase/config.toml")
text = path.read_text()
origin = os.environ["STAGING_ORIGIN"].rstrip("/")
host = os.environ["APP_HOST"]
redirects = f'additional_redirect_urls = ["{origin}", "{origin}/auth/callback"]'

text = re.sub(r"^site_url = .*", f'site_url = "{origin}"', text, count=1, flags=re.M)
text = re.sub(r"^api_url = .*", f'api_url = "http://{host}"', text, count=1, flags=re.M)
text = re.sub(
	r"^additional_redirect_urls = \[[^\]]*\]",
	redirects,
	text,
	count=1,
	flags=re.M | re.S,
)
# Local config enables email confirmations; staging E2E needs immediate JWTs.
# Only the email section uses `true` — SMS stays false.
text = text.replace("enable_confirmations = true", "enable_confirmations = false", 1)

path.write_text(text)
print(f"patched auth site_url/redirects for {origin}; email confirmations disabled")
PY
fi

# Persist cron secrets across deploys (do not regenerate every run).
STAGING_SECRETS_DIR="${STAGING_SECRETS_DIR:-${HOME}/.crm-staging}"
mkdir -p "$STAGING_SECRETS_DIR"
RECURRING_SECRET_FILE="${STAGING_SECRETS_DIR}/recurring-invoices-cron-secret"
if [[ ! -s "$RECURRING_SECRET_FILE" ]]; then
	openssl rand -hex 32 >"$RECURRING_SECRET_FILE"
	chmod 600 "$RECURRING_SECRET_FILE"
	log "generated RECURRING_INVOICES_CRON_SECRET at ${RECURRING_SECRET_FILE}"
fi
RECURRING_INVOICES_CRON_SECRET="$(tr -d '[:space:]' <"$RECURRING_SECRET_FILE")"

# Edge secrets load from supabase/functions/.env (CLI default), not supabase/.env.
# api-v1 defaults to `*` when unset; pin staging origin explicitly.
mkdir -p supabase/functions
cat > supabase/functions/.env <<EOF
API_CORS_ORIGIN=${STAGING_ORIGIN}
CALENDAR_SYNC_STAGING_STUB=1
RECURRING_INVOICES_CRON_SECRET=${RECURRING_INVOICES_CRON_SECRET}
EOF
# Mirror for any tooling that still reads the repo-root supabase/.env.
cat > supabase/.env <<EOF
API_CORS_ORIGIN=${STAGING_ORIGIN}
CALENDAR_SYNC_STAGING_STUB=1
RECURRING_INVOICES_CRON_SECRET=${RECURRING_INVOICES_CRON_SECRET}
EOF

log "starting Supabase (migrations apply on first start)"
if supabase status >/dev/null 2>&1; then
	# Already running — apply any new migrations from this SHA (do not wipe data).
	supabase migration up
	# PostgREST schema cache otherwise misses new tables/RPCs until restart.
	if command -v docker >/dev/null 2>&1; then
		rest_ids="$(
			docker ps --format '{{.ID}} {{.Names}}' \
				| awk 'tolower($0) ~ /rest|postgrest/ { print $1 }' \
				| sort -u \
				| tr '\n' ' '
		)"
		rest_ids="${rest_ids%"${rest_ids##*[![:space:]]}"}"
		if [[ -n "$rest_ids" ]]; then
			log "reloading PostgREST schema cache (${rest_ids})"
			# shellcheck disable=SC2086
			docker kill -s SIGHUP $rest_ids >/dev/null 2>&1 \
				|| docker restart $rest_ids >/dev/null
		fi
	fi
else
	supabase start
fi

status_json="$(supabase status -o json)"
PUBLIC_SUPABASE_URL="$(printf '%s' "$status_json" | jq -r '.API_URL // .apiUrl // empty')"
PUBLIC_SUPABASE_ANON_KEY="$(printf '%s' "$status_json" | jq -r '.ANON_KEY // .anonKey // empty')"
if [[ -z "$PUBLIC_SUPABASE_URL" || -z "$PUBLIC_SUPABASE_ANON_KEY" ]]; then
	log "failed to read API_URL / ANON_KEY from supabase status -o json"
	printf '%s\n' "$status_json" | head -c 2000 >&2 || true
	exit 1
fi
# Prefer the LAN host so browsers on the LAN reach Kong (not 127.0.0.1 from inside the CT).
PUBLIC_SUPABASE_URL="http://${APP_HOST}:54321"
log "Supabase API ${PUBLIC_SUPABASE_URL}"

# Edge signed upload/download URLs are minted from internal SUPABASE_URL (kong:8000).
# Expose the LAN Kong origin so api-v1 can rewrite signed_url for the browser.
# Must land in supabase/functions/.env before edge-runtime restart (Edge secret load path).
mkdir -p supabase/functions
cat > supabase/functions/.env <<EOF
API_CORS_ORIGIN=${STAGING_ORIGIN}
PUBLIC_SUPABASE_URL=${PUBLIC_SUPABASE_URL}
CALENDAR_SYNC_STAGING_STUB=1
RECURRING_INVOICES_CRON_SECRET=${RECURRING_INVOICES_CRON_SECRET}
EOF
cat > supabase/.env <<EOF
API_CORS_ORIGIN=${STAGING_ORIGIN}
PUBLIC_SUPABASE_URL=${PUBLIC_SUPABASE_URL}
CALENDAR_SYNC_STAGING_STUB=1
RECURRING_INVOICES_CRON_SECRET=${RECURRING_INVOICES_CRON_SECRET}
EOF
log "wrote PUBLIC_SUPABASE_URL + CALENDAR_SYNC_STAGING_STUB + recurring cron secret into supabase/functions/.env"

# Edge loads supabase/functions/.env on container create (supabase start), not on a
# plain restart. CLI names use underscores (supabase_edge_runtime_*) or hyphens.
# Do NOT docker rm Edge alone: Kong then returns 503 {"message":"name resolution failed"}
# because the edge-runtime upstream hostname disappears from the Docker network.
# Bounce the whole local stack via the CLI so Kong + Edge share aliases again.
if ! command -v docker >/dev/null 2>&1; then
	log "docker not available — cannot bounce edge-runtime after functions/.env write"
	exit 1
fi
edge_lines="$(
	docker ps --format '{{.ID}} {{.Names}}' \
		| awk 'tolower($0) ~ /edge[_-]runtime/ { print }' \
		| sort -u
)"
edge_names="$(printf '%s\n' "$edge_lines" | awk '{ print $2 }' | paste -sd',' -)"
if [[ -z "$edge_names" ]]; then
	# Broken prior recreate can leave Kong with no edge upstream ("name resolution failed").
	# Still bounce so CLI recreates Edge; fail only if it is missing after start.
	log "no edge-runtime container before bounce — recovering via supabase stop/start"
	docker ps --format '{{.ID}} {{.Names}}' >&2 || true
else
	log "bouncing Supabase stack so Edge loads functions/.env + api-v1 @ ${SHA} (names=${edge_names})"
fi
# Preserve DB/storage volumes (default). --no-backup would wipe staging data.
supabase stop
supabase start

edge_after="$(
	docker ps --format '{{.Names}}' \
		| awk 'tolower($0) ~ /edge[_-]runtime/ { print }' \
		| sort -u \
		| paste -sd',' -
)"
if [[ -z "$edge_after" ]]; then
	log "edge-runtime missing after supabase start — refusing to continue"
	docker ps --format '{{.ID}} {{.Names}}' >&2 || true
	exit 1
fi
log "edge-runtime up after bounce (names=${edge_after})"

# Unauth organisations: healthy Edge serves 401 (verify_jwt) or 200 — never 5xx/000.
# Staging smoke historically expects 401 via proxy for GET /api/v1/organisations.
ready=0
last_code="000"
for i in $(seq 1 90); do
	code="$(
		curl -sS -o /dev/null -w '%{http_code}' --max-time 2 \
			-H "apikey: ${PUBLIC_SUPABASE_ANON_KEY}" \
			"${PUBLIC_SUPABASE_URL}/functions/v1/api-v1/api/v1/organisations" || true
	)"
	last_code="${code:-000}"
	if [[ "$last_code" == "401" || "$last_code" == "200" ]]; then
		log "edge-runtime ready (HTTP ${last_code})"
		ready=1
		break
	fi
	# Log non-healthy codes occasionally so deploy logs show 503/000 progress.
	if (( i % 15 == 0 )); then
		log "edge-runtime not ready yet (HTTP ${last_code}); waiting…"
	fi
	sleep 1
done
if [[ "$ready" -ne 1 ]]; then
	log "edge-runtime did not become healthy after bounce (last HTTP ${last_code}; want 401 or 200)"
	exit 1
fi

# Ensure user services survive SSH disconnects / reboot.
if command -v loginctl >/dev/null 2>&1; then
	sudo loginctl enable-linger "$(id -un)" >/dev/null 2>&1 || true
fi

# Persist public env for the SvelteKit build (dynamic public env).
# Empty PUBLIC_API_BASE_URL → same-origin `/api/v1/...` via the app proxy.
cat > .env <<EOF
PUBLIC_API_BASE_URL=${PUBLIC_API_BASE_URL}
PUBLIC_SUPABASE_URL=${PUBLIC_SUPABASE_URL}
PUBLIC_SUPABASE_ANON_KEY=${PUBLIC_SUPABASE_ANON_KEY}
EOF

log "building SvelteKit"
pnpm build

# User systemd unit so preview survives the SSH session.
mkdir -p "${HOME}/.config/systemd/user"
cat > "${HOME}/.config/systemd/user/${UNIT_NAME}.service" <<EOF
[Unit]
Description=Headquarters staging (Vite preview)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=PUBLIC_API_BASE_URL=${PUBLIC_API_BASE_URL}
Environment=PUBLIC_SUPABASE_URL=${PUBLIC_SUPABASE_URL}
Environment=PUBLIC_SUPABASE_ANON_KEY=${PUBLIC_SUPABASE_ANON_KEY}
ExecStart=$(command -v pnpm) preview --host 0.0.0.0 --port ${APP_PORT}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now "${UNIT_NAME}.service"
systemctl --user restart "${UNIT_NAME}.service"

# Give the preview a moment, then probe.
sleep 2
if systemctl --user is-active --quiet "${UNIT_NAME}.service"; then
	log "preview active on ${STAGING_ORIGIN} (sha ${SHA})"
else
	log "preview failed to start — recent logs:"
	systemctl --user status "${UNIT_NAME}.service" --no-pager || true
	journalctl --user -u "${UNIT_NAME}.service" -n 80 --no-pager || true
	exit 1
fi

curl -fsS --max-time 10 "http://127.0.0.1:${APP_PORT}/" >/dev/null
log "HTTP probe ok"

# Auth → organisations smoke (email/password, confirmations off).
if [[ -x scripts/auth_signup_org_curl_proof.sh ]]; then
	log "running auth signup → org curl proof"
	SUPABASE_URL="${PUBLIC_SUPABASE_URL}" \
		SUPABASE_ANON_KEY="${PUBLIC_SUPABASE_ANON_KEY}" \
		API_BASE="${PUBLIC_SUPABASE_URL}/functions/v1/api-v1" \
		scripts/auth_signup_org_curl_proof.sh
else
	log "auth curl proof script missing — skipped"
fi

# Contacts CRUD + quotes draft smoke (JWT + X-Org-Id).
if [[ -x scripts/contacts_quotes_staging_curl_proof.sh ]]; then
	log "running contacts + quotes draft curl proof"
	SUPABASE_URL="${PUBLIC_SUPABASE_URL}" \
		SUPABASE_ANON_KEY="${PUBLIC_SUPABASE_ANON_KEY}" \
		API_BASE="${PUBLIC_SUPABASE_URL}/functions/v1/api-v1" \
		scripts/contacts_quotes_staging_curl_proof.sh
else
	log "contacts/quotes curl proof script missing — skipped"
fi

# Leads + clients CRUD smoke (JWT + X-Org-Id).
if [[ -x scripts/leads_clients_staging_curl_proof.sh ]]; then
	log "running leads + clients curl proof"
	SUPABASE_URL="${PUBLIC_SUPABASE_URL}" \
		SUPABASE_ANON_KEY="${PUBLIC_SUPABASE_ANON_KEY}" \
		API_BASE="${PUBLIC_SUPABASE_URL}/functions/v1/api-v1" \
		scripts/leads_clients_staging_curl_proof.sh
else
	log "leads/clients curl proof script missing — skipped"
fi

# Products CRUD smoke (JWT + X-Org-Id).
if [[ -x scripts/products_staging_curl_proof.sh ]]; then
	log "running products curl proof"
	SUPABASE_URL="${PUBLIC_SUPABASE_URL}" \
		SUPABASE_ANON_KEY="${PUBLIC_SUPABASE_ANON_KEY}" \
		API_BASE="${PUBLIC_SUPABASE_URL}/functions/v1/api-v1" \
		scripts/products_staging_curl_proof.sh
else
	log "products curl proof script missing — skipped"
fi

# Lead board reorder + currency fallback + contact client links.
if [[ -x scripts/lead_board_client_links_staging_curl_proof.sh ]]; then
	log "running lead board / client links curl proof"
	SUPABASE_URL="${PUBLIC_SUPABASE_URL}" \
		SUPABASE_ANON_KEY="${PUBLIC_SUPABASE_ANON_KEY}" \
		API_BASE="${PUBLIC_SUPABASE_URL}/functions/v1/api-v1" \
		scripts/lead_board_client_links_staging_curl_proof.sh
else
	log "lead board / client links curl proof script missing — skipped"
fi

# Invoice draft CRUD + send/void lock + accepted-quote conversion.
if [[ -x scripts/invoices_staging_curl_proof.sh ]]; then
	log "running invoices foundation curl proof"
	SUPABASE_URL="${PUBLIC_SUPABASE_URL}" \
		SUPABASE_ANON_KEY="${PUBLIC_SUPABASE_ANON_KEY}" \
		API_BASE="${PUBLIC_SUPABASE_URL}/functions/v1/api-v1" \
		scripts/invoices_staging_curl_proof.sh
else
	log "invoices curl proof script missing — skipped"
fi


# Bills / payables foundation: vendor + bill draft CRUD + receive/void.
if [[ -x scripts/bills_staging_curl_proof.sh ]]; then
	log "running bills payables curl proof"
	SUPABASE_URL="${PUBLIC_SUPABASE_URL}" \
		SUPABASE_ANON_KEY="${PUBLIC_SUPABASE_ANON_KEY}" \
		API_BASE="${PUBLIC_SUPABASE_URL}/functions/v1/api-v1" \
		scripts/bills_staging_curl_proof.sh
else
	log "bills curl proof script missing — skipped"
fi

# Tasks foundation: CRUD + assignee=me + entity link + ETag.
if [[ -x scripts/tasks_staging_curl_proof.sh ]]; then
	log "running tasks foundation curl proof"
	SUPABASE_URL="${PUBLIC_SUPABASE_URL}" \
		SUPABASE_ANON_KEY="${PUBLIC_SUPABASE_ANON_KEY}" \
		API_BASE="${PUBLIC_SUPABASE_URL}/functions/v1/api-v1" \
		scripts/tasks_staging_curl_proof.sh
else
	log "tasks curl proof script missing — skipped"
fi

# Meetings foundation: CRUD + nested attendees + upcoming + ETag.
if [[ -x scripts/meetings_staging_curl_proof.sh ]]; then
	log "running meetings foundation curl proof"
	SUPABASE_URL="${PUBLIC_SUPABASE_URL}" \
		SUPABASE_ANON_KEY="${PUBLIC_SUPABASE_ANON_KEY}" \
		API_BASE="${PUBLIC_SUPABASE_URL}/functions/v1/api-v1" \
		scripts/meetings_staging_curl_proof.sh
else
	log "meetings curl proof script missing — skipped"
fi

# Calendar C2 sync: reserved-col reject + stub OAuth + push set/clear.
if [[ -x scripts/calendar_sync_staging_curl_proof.sh ]]; then
	log "running calendar sync curl proof"
	SUPABASE_URL="${PUBLIC_SUPABASE_URL}" \
		SUPABASE_ANON_KEY="${PUBLIC_SUPABASE_ANON_KEY}" \
		API_BASE="${PUBLIC_SUPABASE_URL}/functions/v1/api-v1" \
		scripts/calendar_sync_staging_curl_proof.sh
else
	log "calendar sync curl proof script missing — skipped"
fi

# Meeting assistant M2: transcript → summary stub → accept proposal → task.
if [[ -x scripts/meeting_assistant_staging_curl_proof.sh ]]; then
	log "running meeting assistant M2 curl proof"
	SUPABASE_URL="${PUBLIC_SUPABASE_URL}" \
		SUPABASE_ANON_KEY="${PUBLIC_SUPABASE_ANON_KEY}" \
		API_BASE="${PUBLIC_SUPABASE_URL}/functions/v1/api-v1" \
		scripts/meeting_assistant_staging_curl_proof.sh
else
	log "meeting assistant curl proof script missing — skipped"
fi

# Projects foundation: CRUD + nested workspace + board/card drag + ETag.
if [[ -x scripts/projects_staging_curl_proof.sh ]]; then
	log "running projects foundation curl proof"
	SUPABASE_URL="${PUBLIC_SUPABASE_URL}" \
		SUPABASE_ANON_KEY="${PUBLIC_SUPABASE_ANON_KEY}" \
		API_BASE="${PUBLIC_SUPABASE_URL}/functions/v1/api-v1" \
		scripts/projects_staging_curl_proof.sh
else
	log "projects curl proof script missing — skipped"
fi

# Recurring invoices foundation: schedule CRUD + lifecycle + run-now draft invoice.
if [[ -x scripts/recurring_invoices_staging_curl_proof.sh ]]; then
	log "running recurring invoices foundation curl proof"
	SUPABASE_URL="${PUBLIC_SUPABASE_URL}" \
		SUPABASE_ANON_KEY="${PUBLIC_SUPABASE_ANON_KEY}" \
		API_BASE="${PUBLIC_SUPABASE_URL}/functions/v1/api-v1" \
		scripts/recurring_invoices_staging_curl_proof.sh
else
	log "recurring invoices curl proof script missing — skipped"
fi

# Payments foundation: inbound/outbound allocate + reverse + list doc filters.
if [[ -x scripts/payments_staging_curl_proof.sh ]]; then
	log "running payments foundation curl proof"
	SUPABASE_URL="${PUBLIC_SUPABASE_URL}" \
		SUPABASE_ANON_KEY="${PUBLIC_SUPABASE_ANON_KEY}" \
		API_BASE="${PUBLIC_SUPABASE_URL}/functions/v1/api-v1" \
		scripts/payments_staging_curl_proof.sh
else
	log "payments curl proof script missing — skipped"
fi

# Client Money tab: quotes + invoices list ?client_id= filters.
if [[ -x scripts/client_money_staging_curl_proof.sh ]]; then
	log "running client money tab curl proof"
	SUPABASE_URL="${PUBLIC_SUPABASE_URL}" \
		SUPABASE_ANON_KEY="${PUBLIC_SUPABASE_ANON_KEY}" \
		API_BASE="${PUBLIC_SUPABASE_URL}/functions/v1/api-v1" \
		scripts/client_money_staging_curl_proof.sh
else
	log "client money curl proof script missing — skipped"
fi

# Product → quote line → accept → from-quote (product_id + SKU/price/tax snapshots).
if [[ -x scripts/product_quote_invoice_staging_curl_proof.sh ]]; then
	log "running product→quote→invoice convert curl proof"
	SUPABASE_URL="${PUBLIC_SUPABASE_URL}" \
		SUPABASE_ANON_KEY="${PUBLIC_SUPABASE_ANON_KEY}" \
		API_BASE="${PUBLIC_SUPABASE_URL}/functions/v1/api-v1" \
		scripts/product_quote_invoice_staging_curl_proof.sh
else
	log "product→quote→invoice convert curl proof script missing — skipped"
fi

# Personal mailbox + org AI integrations (Wave A foundations; no secret echo).
if [[ -x scripts/email_mailbox_ai_staging_curl_proof.sh ]]; then
	log "running mailbox + AI integrations curl proof"
	SUPABASE_URL="${PUBLIC_SUPABASE_URL}" \
		SUPABASE_ANON_KEY="${PUBLIC_SUPABASE_ANON_KEY}" \
		API_BASE="${PUBLIC_SUPABASE_URL}/functions/v1/api-v1" \
		scripts/email_mailbox_ai_staging_curl_proof.sh
else
	log "mailbox/AI curl proof script missing — skipped"
fi

# Email templates CRUD + personal working inbox list.
if [[ -x scripts/email_templates_inbox_staging_curl_proof.sh ]]; then
	log "running email templates + personal inbox curl proof"
	SUPABASE_URL="${PUBLIC_SUPABASE_URL}" \
		SUPABASE_ANON_KEY="${PUBLIC_SUPABASE_ANON_KEY}" \
		API_BASE="${PUBLIC_SUPABASE_URL}/functions/v1/api-v1" \
		scripts/email_templates_inbox_staging_curl_proof.sh
else
	log "email templates/inbox curl proof script missing — skipped"
fi

# Documents upload-intent signed_url must use LAN Kong (${APP_HOST}:54321), not kong.
if [[ -x scripts/documents_signed_url_staging_curl_proof.sh ]]; then
	log "running documents signed upload URL host curl proof"
	SUPABASE_URL="${PUBLIC_SUPABASE_URL}" \
		SUPABASE_ANON_KEY="${PUBLIC_SUPABASE_ANON_KEY}" \
		API_BASE="${PUBLIC_SUPABASE_URL}/functions/v1/api-v1" \
		scripts/documents_signed_url_staging_curl_proof.sh
else
	log "documents signed URL curl proof script missing — skipped"
fi

# Recurring invoices due-claim cron (every 5m). Wrapper keeps the secret off argv/ps.
RECURRING_CRON_WRAPPER="${STAGING_SECRETS_DIR}/run-recurring-invoices-cron.sh"
cat >"$RECURRING_CRON_WRAPPER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
SECRET=\$(tr -d '[:space:]' <"${RECURRING_SECRET_FILE}")
exec curl -fsS -X POST \\
  -H "x-recurring-invoices-cron-secret: \${SECRET}" \\
  "http://127.0.0.1:54321/functions/v1/jobs-recurring-invoices"
EOF
chmod 700 "$RECURRING_CRON_WRAPPER"
CRON_LINE="*/5 * * * * ${RECURRING_CRON_WRAPPER} >>${STAGING_SECRETS_DIR}/recurring-invoices-cron.log 2>&1"
if command -v crontab >/dev/null 2>&1; then
	existing="$(crontab -l 2>/dev/null || true)"
	filtered="$(printf '%s\n' "$existing" | awk '!/run-recurring-invoices-cron\\.sh/')"
	printf '%s\n%s\n' "$filtered" "$CRON_LINE" | crontab -
	log "installed recurring invoices cron (every 5m → jobs-recurring-invoices)"
	# Immediate tick so due schedules after deploy do not wait for the next 5m boundary.
	if "$RECURRING_CRON_WRAPPER"; then
		log "recurring invoices cron tick ok"
	else
		log "recurring invoices cron tick failed (non-fatal — check Edge secret load)"
	fi
else
	log "crontab not available — skipping recurring invoices schedule install"
fi

log "done"

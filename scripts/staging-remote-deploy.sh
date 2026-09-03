#!/usr/bin/env bash
# Remote staging deploy for Headquarters on deploy-svelte.
# Invoked over SSH by .forgejo/workflows/staging-deploy.yml — no secrets in this file.
set -euo pipefail

APP_DIR="${APP_DIR:-/home/deploy/apps/headquarters}"
REPO_URL="${REPO_URL:-https://forge.purecambo.org/joe/crm-project.git}"
BRANCH="${BRANCH:-staging}"
DEPLOY_SHA="${DEPLOY_SHA:-}"
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

if [[ -n "$DEPLOY_SHA" ]]; then
	# Pin the deployment to the workflow revision. A newer staging push may
	# otherwise move origin/staging while this job is waiting for a runner.
	git -C "$APP_DIR" cat-file -e "${DEPLOY_SHA}^{commit}"
	git -C "$APP_DIR" checkout -f -B "$BRANCH" "$DEPLOY_SHA"
	git -C "$APP_DIR" reset --hard "$DEPLOY_SHA"
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
# Deploy smoke proofs create many fresh users immediately before Playwright.
# Keep this staging-only allowance above their combined five-minute request count.
text = re.sub(
    r"^sign_in_sign_ups = \d+",
    "sign_in_sign_ups = 100",
    text,
    count=1,
    flags=re.M,
)

path.write_text(text)
print(
    f"patched auth site_url/redirects for {origin}; "
    "email confirmations disabled; sign-in/signup limit=100"
)
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
MAILBOX_SECRET_FILE="${STAGING_SECRETS_DIR}/mailbox-sync-secret"
if [[ ! -s "$MAILBOX_SECRET_FILE" ]]; then
	openssl rand -hex 32 >"$MAILBOX_SECRET_FILE"
	chmod 600 "$MAILBOX_SECRET_FILE"
	log "generated MAILBOX_SYNC_SECRET at ${MAILBOX_SECRET_FILE}"
fi
MAILBOX_SYNC_SECRET="$(tr -d '[:space:]' <"$MAILBOX_SECRET_FILE")"

# Edge secrets load from supabase/functions/.env (CLI default), not supabase/.env.
# api-v1 defaults to `*` when unset; pin staging origin explicitly.
# Invitations send via the inviter's personal mailbox SMTP (My settings → Mail).
mkdir -p supabase/functions
cat > supabase/functions/.env <<EOF
API_CORS_ORIGIN=${STAGING_ORIGIN}
CALENDAR_SYNC_STAGING_STUB=1
RECURRING_INVOICES_CRON_SECRET=${RECURRING_INVOICES_CRON_SECRET}
MAILBOX_SYNC_SECRET=${MAILBOX_SYNC_SECRET}
APP_BASE_URL=${STAGING_ORIGIN}
EOF
# Mirror for any tooling that still reads the repo-root supabase/.env.
cat > supabase/.env <<EOF
API_CORS_ORIGIN=${STAGING_ORIGIN}
CALENDAR_SYNC_STAGING_STUB=1
RECURRING_INVOICES_CRON_SECRET=${RECURRING_INVOICES_CRON_SECRET}
MAILBOX_SYNC_SECRET=${MAILBOX_SYNC_SECRET}
APP_BASE_URL=${STAGING_ORIGIN}
EOF

# hosted_subscriptions was renamed 20260829190000 → 20260829175735 so the
# filename matches the version id production recorded via MCP. Staging DBs that
# applied the old filename still list 20260829190000 in schema_migrations, which
# makes `migration up` / `supabase start` fail with "Remote migration versions
# not found in local migrations directory".
#
# Never rename an already-applied migration version again — heal history here instead.
STALE_HOSTED_SUB_MIGRATION=20260829190000
CANONICAL_HOSTED_SUB_MIGRATION=20260829175735

supabase_db_container() {
	local project_id container
	project_id="$(
		awk -F'"' '/^project_id[[:space:]]*=/ { print $2; exit }' supabase/config.toml 2>/dev/null || true
	)"
	if [[ -n "$project_id" ]]; then
		container="supabase_db_${project_id}"
		if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$container"; then
			printf '%s\n' "$container"
			return 0
		fi
	fi
	docker ps --format '{{.Names}}' 2>/dev/null | awk '/^supabase_db_/ { print; exit }'
}

db_has_schema_migration_version() {
	local version="$1"
	local container
	container="$(supabase_db_container)"
	[[ -n "$container" ]] || return 1
	docker exec "$container" psql -U postgres -d postgres -Atqc \
		"select 1 from supabase_migrations.schema_migrations where version = '${version}' limit 1" \
		2>/dev/null | grep -q 1
}

ensure_local_db_for_migration_repair() {
	# Full stack may be down; start Postgres only so we can rewrite schema_migrations.
	if supabase status >/dev/null 2>&1; then
		return 0
	fi
	if [[ -n "$(supabase_db_container)" ]]; then
		return 0
	fi
	log "starting local DB only (for migration history repair)"
	supabase db start >/dev/null
}

repair_renamed_hosted_subscriptions_migration() {
	ensure_local_db_for_migration_repair || true

	local list has_stale=0 has_canonical=0
	list="$(supabase migration list --local 2>/dev/null || true)"
	if printf '%s\n' "$list" | grep -Eq "(^|[[:space:]])${STALE_HOSTED_SUB_MIGRATION}([[:space:]]|$)"; then
		has_stale=1
	elif db_has_schema_migration_version "$STALE_HOSTED_SUB_MIGRATION"; then
		has_stale=1
	fi
	if printf '%s\n' "$list" | grep -Eq "(^|[[:space:]])${CANONICAL_HOSTED_SUB_MIGRATION}([[:space:]]|$)"; then
		has_canonical=1
	elif db_has_schema_migration_version "$CANONICAL_HOSTED_SUB_MIGRATION"; then
		has_canonical=1
	fi

	if [[ "$has_stale" -ne 1 ]]; then
		return 0
	fi

	log "repairing renamed migration ${STALE_HOSTED_SUB_MIGRATION} → ${CANONICAL_HOSTED_SUB_MIGRATION}"
	supabase migration repair --local --status reverted "$STALE_HOSTED_SUB_MIGRATION"
	if [[ "$has_canonical" -ne 1 ]]; then
		# Identical SQL already applied under the old version id — do not re-run.
		supabase migration repair --local --status applied "$CANONICAL_HOSTED_SUB_MIGRATION"
	fi
}

supabase_start_with_migration_repair() {
	# Always heal history before start when the DB volume may still carry the stale id.
	repair_renamed_hosted_subscriptions_migration || true
	local start_log
	start_log="$(mktemp)"
	if supabase start 2>"$start_log"; then
		cat "$start_log" >&2 || true
		rm -f "$start_log"
		return 0
	fi
	cat "$start_log" >&2 || true
	if grep -Eq "Remote migration versions not found|${STALE_HOSTED_SUB_MIGRATION}" "$start_log"; then
		log "supabase start failed on migration history — repairing and retrying"
		repair_renamed_hosted_subscriptions_migration
		rm -f "$start_log"
		supabase start
		return 0
	fi
	rm -f "$start_log"
	return 1
}

log "starting Supabase (migrations apply on first start)"
if supabase status >/dev/null 2>&1; then
	# Already running — heal history if needed, then apply any new migrations (do not wipe data).
	repair_renamed_hosted_subscriptions_migration
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
	supabase_start_with_migration_repair
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
MAILBOX_SYNC_SECRET=${MAILBOX_SYNC_SECRET}
APP_BASE_URL=${STAGING_ORIGIN}
EOF
cat > supabase/.env <<EOF
API_CORS_ORIGIN=${STAGING_ORIGIN}
PUBLIC_SUPABASE_URL=${PUBLIC_SUPABASE_URL}
CALENDAR_SYNC_STAGING_STUB=1
RECURRING_INVOICES_CRON_SECRET=${RECURRING_INVOICES_CRON_SECRET}
MAILBOX_SYNC_SECRET=${MAILBOX_SYNC_SECRET}
APP_BASE_URL=${STAGING_ORIGIN}
EOF
log "wrote PUBLIC_SUPABASE_URL + APP_BASE_URL into supabase/functions/.env"

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
supabase_start_with_migration_repair

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

# Mailbox due-list cron (every minute). SQL decides which mailbox intervals are due.
# curl reads the secret-bearing header from stdin so it is not exposed via argv/ps.
MAILBOX_CRON_WRAPPER="${STAGING_SECRETS_DIR}/run-mailbox-sync-cron.sh"
cat >"$MAILBOX_CRON_WRAPPER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
SECRET=\$(tr -d '[:space:]' <"${MAILBOX_SECRET_FILE}")
curl -fsS --config - <<CURL_CONFIG
request = "POST"
header = "x-mailbox-sync-secret: \${SECRET}"
url = "http://127.0.0.1:54321/functions/v1/mailbox-sync"
CURL_CONFIG
EOF
chmod 700 "$MAILBOX_CRON_WRAPPER"
MAILBOX_CRON_LINE="* * * * * ${MAILBOX_CRON_WRAPPER} >>${STAGING_SECRETS_DIR}/mailbox-sync-cron.log 2>&1"
if command -v crontab >/dev/null 2>&1; then
	existing="$(crontab -l 2>/dev/null || true)"
	filtered="$(printf '%s\n' "$existing" | awk '!/run-mailbox-sync-cron\\.sh/')"
	printf '%s\n%s\n' "$filtered" "$MAILBOX_CRON_LINE" | crontab -
	log "installed mailbox sync cron (every minute → mailbox-sync; SQL due-list controls intervals)"
	# Immediate non-fatal tick verifies the wrapper without delaying until the next minute.
	if "$MAILBOX_CRON_WRAPPER" >>"${STAGING_SECRETS_DIR}/mailbox-sync-cron.log" 2>&1; then
		log "mailbox sync cron tick ok"
	else
		log "mailbox sync cron tick failed (non-fatal — check mailbox-sync-cron.log)"
	fi
else
	log "crontab not available — skipping mailbox sync schedule install"
fi

log "done"

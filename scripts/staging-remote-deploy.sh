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
# Keep email confirmations off (config.toml) so email/password signup returns a JWT.
if [[ -f supabase/config.toml ]]; then
	sed -i \
		-e "s|^site_url = .*|site_url = \"${STAGING_ORIGIN}\"|" \
		-e "s|^additional_redirect_urls = .*|additional_redirect_urls = [\"${STAGING_ORIGIN}\"]|" \
		-e "s|^api_url = .*|api_url = \"http://${APP_HOST}\"|" \
		supabase/config.toml
fi

# Edge Function CORS for browser → Kong (Auth uses its own allow-list via site_url).
# api-v1 defaults to `*` when unset; pin staging origin explicitly.
mkdir -p supabase
cat > supabase/.env <<EOF
API_CORS_ORIGIN=${STAGING_ORIGIN}
EOF

log "starting Supabase (migrations apply on first start)"
if supabase status >/dev/null 2>&1; then
	# Already running — apply any new migrations from this SHA (do not wipe data).
	supabase migration up
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

log "done"

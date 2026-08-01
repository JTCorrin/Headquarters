#!/usr/bin/env bash
# Remote staging deploy for Headquarters on deploy-svelte.
# Invoked over SSH by .forgejo/workflows/staging-deploy.yml — no secrets in this file.
set -euo pipefail

APP_DIR="${APP_DIR:-/home/deploy/apps/headquarters}"
REPO_URL="${REPO_URL:-https://forge.purecambo.org/joe/crm-project.git}"
BRANCH="${BRANCH:-staging}"
APP_HOST="${APP_HOST:-192.168.5.136}"
APP_PORT="${APP_PORT:-4173}"
# Browser → Kong → edge function. Client paths are `/api/v1/...`.
PUBLIC_API_BASE_URL="${PUBLIC_API_BASE_URL:-http://${APP_HOST}:54321/functions/v1/api-v1}"
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
if [[ -f supabase/config.toml ]]; then
	sed -i \
		-e "s|^site_url = .*|site_url = \"http://${APP_HOST}:${APP_PORT}\"|" \
		-e "s|^additional_redirect_urls = .*|additional_redirect_urls = [\"http://${APP_HOST}:${APP_PORT}\"]|" \
		-e "s|^api_url = .*|api_url = \"http://${APP_HOST}\"|" \
		supabase/config.toml
fi

log "starting Supabase (migrations apply on first start)"
if supabase status >/dev/null 2>&1; then
	# Already running — apply any new migrations from this SHA (do not wipe data).
	supabase migration up
else
	supabase start
fi

# Ensure user services survive SSH disconnects / reboot.
if command -v loginctl >/dev/null 2>&1; then
	sudo loginctl enable-linger "$(id -un)" >/dev/null 2>&1 || true
fi

# Persist public API origin for the SvelteKit build (dynamic public env).
cat > .env <<EOF
PUBLIC_API_BASE_URL=${PUBLIC_API_BASE_URL}
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
	log "preview active on http://${APP_HOST}:${APP_PORT} (sha ${SHA})"
else
	log "preview failed to start — recent logs:"
	systemctl --user status "${UNIT_NAME}.service" --no-pager || true
	journalctl --user -u "${UNIT_NAME}.service" -n 80 --no-pager || true
	exit 1
fi

curl -fsS --max-time 10 "http://127.0.0.1:${APP_PORT}/" >/dev/null
log "HTTP probe ok"
log "done"

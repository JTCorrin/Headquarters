#!/usr/bin/env bash
# Bring up local Supabase (Docker via CLI), merge .env, serve api-v1, and run the app.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LOCAL_DIR="$ROOT_DIR/.local"
MARKER_FILE="$LOCAL_DIR/dev-stack.initialized"
FUNCTIONS_PID_FILE="$LOCAL_DIR/api-v1.pid"
FUNCTIONS_LOG_FILE="$LOCAL_DIR/api-v1.log"
ENV_FILE="$ROOT_DIR/.env"
ENV_EXAMPLE="$ROOT_DIR/.env.example"

DO_RESET=0
NO_APP=0
SKIP_INSTALL=0

usage() {
	cat <<'EOF'
Usage: scripts/dev-up.sh [options]

  --reset         Run `supabase db reset` (also runs on first clone)
  --no-app        Start backend only (skip `pnpm dev`)
  --skip-install  Skip `pnpm install` even if node_modules is missing
  -h, --help      Show this help

Prerequisites: Docker, Node.js >= 22, pnpm, Supabase CLI (~2.111).
EOF
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--reset) DO_RESET=1 ;;
		--no-app) NO_APP=1 ;;
		--skip-install) SKIP_INSTALL=1 ;;
		-h | --help)
			usage
			exit 0
			;;
		*)
			echo "Unknown option: $1" >&2
			usage >&2
			exit 1
			;;
	esac
	shift
done

die() {
	echo "error: $*" >&2
	exit 1
}

need_cmd() {
	command -v "$1" >/dev/null 2>&1 || die "'$1' is required but not found in PATH"
}

check_node_version() {
	local major
	major="$(node -p "process.versions.node.split('.')[0]")"
	if [[ "$major" -lt 22 ]]; then
		die "Node.js >= 22 is required (found $(node -v))"
	fi
}

# Upsert KEY=VALUE in an env file. With force=1 always replace; force=0 only if missing/empty.
upsert_env() {
	local file="$1"
	local key="$2"
	local value="$3"
	local force="${4:-1}"
	local tmp

	touch "$file"
	if [[ "$force" != "1" ]]; then
		if grep -Eq "^${key}=" "$file"; then
			local current
			current="$(grep -E "^${key}=" "$file" | head -1 | cut -d= -f2-)"
			if [[ -n "$current" ]]; then
				return 0
			fi
		fi
	fi

	tmp="$(mktemp)"
	if grep -Eq "^${key}=" "$file"; then
		# Escape & and \ for sed replacement
		local escaped
		escaped="$(printf '%s' "$value" | sed -e 's/[&\\]/\\&/g')"
		sed -E "s|^${key}=.*|${key}=${escaped}|" "$file" >"$tmp"
	else
		cat "$file" >"$tmp"
		printf '%s=%s\n' "$key" "$value" >>"$tmp"
	fi
	mv "$tmp" "$file"
}

env_value() {
	local file="$1"
	local key="$2"
	if [[ ! -f "$file" ]]; then
		echo ""
		return 0
	fi
	grep -E "^${key}=" "$file" 2>/dev/null | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true
}

stop_functions_serve() {
	if [[ -f "$FUNCTIONS_PID_FILE" ]]; then
		local pid
		pid="$(cat "$FUNCTIONS_PID_FILE" 2>/dev/null || true)"
		if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
			kill "$pid" 2>/dev/null || true
			wait "$pid" 2>/dev/null || true
		fi
		rm -f "$FUNCTIONS_PID_FILE"
	fi
}

echo "==> Checking prerequisites"
need_cmd docker
need_cmd node
need_cmd pnpm
need_cmd supabase
check_node_version

if ! docker info >/dev/null 2>&1; then
	die "Docker daemon is not running (needed by \`supabase start\`)"
fi

mkdir -p "$LOCAL_DIR"

if [[ "$SKIP_INSTALL" -eq 0 ]] && [[ ! -d "$ROOT_DIR/node_modules" ]]; then
	echo "==> Installing dependencies (pnpm install)"
	pnpm install
fi

echo "==> Starting Supabase (Docker via CLI)"
supabase start

if [[ "$DO_RESET" -eq 1 ]] || [[ ! -f "$MARKER_FILE" ]]; then
	echo "==> Resetting local database (migrations + seed)"
	supabase db reset --local
	touch "$MARKER_FILE"
fi

echo "==> Writing .env from .env.example + supabase status"
if [[ ! -f "$ENV_EXAMPLE" ]]; then
	die "missing $ENV_EXAMPLE"
fi
if [[ ! -f "$ENV_FILE" ]]; then
	cp "$ENV_EXAMPLE" "$ENV_FILE"
elif ! grep -Eq '^PUBLIC_SUPABASE_URL=' "$ENV_FILE" 2>/dev/null; then
	# Stale or unrelated .env — seed from example without clobbering unknown keys blindly.
	# Prefer a clean template when Headquarters keys are absent.
	cp "$ENV_EXAMPLE" "$ENV_FILE"
fi

STATUS_ENV="$(mktemp)"
trap 'rm -f "$STATUS_ENV"' EXIT
supabase status -o env >"$STATUS_ENV"

API_URL="$(env_value "$STATUS_ENV" API_URL)"
ANON_KEY="$(env_value "$STATUS_ENV" ANON_KEY)"
if [[ -z "$ANON_KEY" ]]; then
	ANON_KEY="$(env_value "$STATUS_ENV" PUBLISHABLE_KEY)"
fi

[[ -n "$API_URL" ]] || die "could not read API_URL from \`supabase status -o env\`"
[[ -n "$ANON_KEY" ]] || die "could not read ANON_KEY/PUBLISHABLE_KEY from \`supabase status -o env\`"

upsert_env "$ENV_FILE" "PUBLIC_SUPABASE_URL" "$API_URL" 1
upsert_env "$ENV_FILE" "PUBLIC_SUPABASE_ANON_KEY" "$ANON_KEY" 1
upsert_env "$ENV_FILE" "API_V1_UPSTREAM" "${API_URL%/}/functions/v1/api-v1" 0
upsert_env "$ENV_FILE" "APP_BASE_URL" "http://127.0.0.1:5173" 0

echo "==> Serving Edge Function api-v1"
stop_functions_serve
# shellcheck disable=SC2086
nohup supabase functions serve api-v1 >"$FUNCTIONS_LOG_FILE" 2>&1 &
echo $! >"$FUNCTIONS_PID_FILE"
sleep 1
if ! kill -0 "$(cat "$FUNCTIONS_PID_FILE")" 2>/dev/null; then
	die "api-v1 failed to start; see $FUNCTIONS_LOG_FILE"
fi

cat <<EOF

Local stack is up.

  App:     http://127.0.0.1:5173
  API:     $API_URL
  Studio:  http://127.0.0.1:54323

  Sign up in the app, then create an organisation via onboarding.
  Optional OAuth / mailbox / calendar / cron secrets: see .env.example
  Stop with: ./scripts/dev-down.sh

EOF

if [[ "$NO_APP" -eq 1 ]]; then
	echo "Backend only (--no-app). Run \`pnpm dev\` in another terminal when ready."
	exit 0
fi

echo "==> Starting SvelteKit (pnpm dev)"
exec pnpm dev

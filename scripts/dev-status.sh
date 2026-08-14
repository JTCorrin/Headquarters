#!/usr/bin/env bash
# Print local stack URLs and public keys (no service-role key).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="$ROOT_DIR/.env"
FUNCTIONS_PID_FILE="$ROOT_DIR/.local/api-v1.pid"

env_value() {
	local file="$1"
	local key="$2"
	if [[ ! -f "$file" ]]; then
		echo ""
		return 0
	fi
	grep -E "^${key}=" "$file" 2>/dev/null | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true
}

if ! command -v supabase >/dev/null 2>&1; then
	echo "error: supabase CLI not found" >&2
	exit 1
fi

if ! supabase status >/dev/null 2>&1; then
	echo "Supabase local stack does not appear to be running."
	echo "Start with: ./scripts/dev-up.sh"
	exit 1
fi

STATUS_ENV="$(mktemp)"
trap 'rm -f "$STATUS_ENV"' EXIT
supabase status -o env >"$STATUS_ENV"

API_URL="$(env_value "$STATUS_ENV" API_URL)"
ANON_KEY="$(env_value "$STATUS_ENV" ANON_KEY)"
if [[ -z "$ANON_KEY" ]]; then
	ANON_KEY="$(env_value "$STATUS_ENV" PUBLISHABLE_KEY)"
fi
STUDIO_URL="$(env_value "$STATUS_ENV" STUDIO_URL)"
[[ -n "$STUDIO_URL" ]] || STUDIO_URL="http://127.0.0.1:54323"

APP_URL="$(env_value "$ENV_FILE" APP_BASE_URL)"
[[ -n "$APP_URL" ]] || APP_URL="http://127.0.0.1:5173"

API_SERVE="stopped"
if [[ -f "$FUNCTIONS_PID_FILE" ]]; then
	pid="$(cat "$FUNCTIONS_PID_FILE" 2>/dev/null || true)"
	if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
		API_SERVE="running (pid $pid)"
	fi
fi

cat <<EOF
Headquarters local status

  App:            $APP_URL
  Supabase API:   $API_URL
  Studio:         $STUDIO_URL
  api-v1 serve:   $API_SERVE
  Anon key:       ${ANON_KEY:0:24}… (${#ANON_KEY} chars)

  .env:           $ENV_FILE
EOF

#!/usr/bin/env bash
# Stop Edge Function serve process and local Supabase containers.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LOCAL_DIR="$ROOT_DIR/.local"
FUNCTIONS_PID_FILE="$LOCAL_DIR/api-v1.pid"

if [[ -f "$FUNCTIONS_PID_FILE" ]]; then
	pid="$(cat "$FUNCTIONS_PID_FILE" 2>/dev/null || true)"
	if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
		echo "==> Stopping api-v1 (pid $pid)"
		kill "$pid" 2>/dev/null || true
		wait "$pid" 2>/dev/null || true
	fi
	rm -f "$FUNCTIONS_PID_FILE"
fi

if command -v supabase >/dev/null 2>&1; then
	echo "==> Stopping Supabase"
	supabase stop || true
else
	echo "warning: supabase CLI not found; skipped \`supabase stop\`" >&2
fi

echo "Local stack stopped."

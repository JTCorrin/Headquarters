#!/usr/bin/env bash
# Staging proof notes for real IMAP (non-synthetic hosts).
#
# Automated deploy curl still uses imap.example.test synthetic ingest
# (see email_mailbox_ai_staging_curl_proof.sh) and asserts:
#   POST /api/v1/me/mailbox/sync → ingested >= 1
#   GET  /api/v1/me/email-messages → non-empty
#
# Real-host verification (manual / Joe mailbox on staging):
#   1. Configure personal mailbox with real IMAP (tls/starttls) + password
#   2. POST /api/v1/me/mailbox/test — live IMAP probe (connect+LOGIN+LOGOUT)
#      Expect ok:true on good creds; timeout / imap_auth_failed / imap_connection_failed
#      when bad. *.example.test stays non-network OK when credentials present.
#   3. POST /api/v1/me/mailbox/sync
#   4. Expect data.ok == true and data.ingested >= 1 (or 0 if inbox empty in lookback)
#   5. Expect data.error_code != imap_not_configured_for_host (removed)
#   6. Deadlines: connect ~10s, command ~30s, probe overall ~15s, sync overall ~90s
#      → error_code timeout (not collapsed into imap_connection_failed)
#   7. GET /api/v1/me/email-messages lists owned mail; contact Email stays address-filtered
#
# Auth failures increment consecutive_auth_failures; 3 → status=error (circuit open).

set -euo pipefail
echo "real IMAP staging note — synthetic path covered by email_mailbox_ai_staging_curl_proof.sh; Test is live probe"
exit 0

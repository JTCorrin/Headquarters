/**
 * Edge cron entry for bounded mailbox sync.
 * Invoke periodically (e.g. every 5m) with service role or verify_jwt=false + internal secret.
 * Locked bounds live on mailbox_accounts / claim_mailbox_sync_lease.
 */
import { createClient } from "@supabase/supabase-js";
import { authorizeCronRequest } from "../_shared/cron-auth.ts";
import { runMailboxSyncCycle } from "../api-v1/email-messages.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), {
      status: 405,
    });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    return new Response(JSON.stringify({ error: "SERVICE_UNAVAILABLE" }), {
      status: 500,
    });
  }

  const service = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const auth = authorizeCronRequest(req, {
    envSecret: Deno.env.get("MAILBOX_SYNC_SECRET"),
    headerName: "x-mailbox-sync-secret",
    serviceRoleKey: key,
    missingConfigLog:
      "MAILBOX_SYNC_SECRET and SUPABASE_SERVICE_ROLE_KEY are unset; refusing to run",
  });
  if (!auth.ok) {
    // Hosted pg_cron sends the vault secret; accept when RPC confirms it.
    const supplied = req.headers.get("x-mailbox-sync-secret")?.trim() ?? "";
    let vaultOk = false;
    if (supplied) {
      const { data, error } = await service.rpc("verify_mailbox_sync_secret", {
        p_supplied: supplied,
      });
      if (error) {
        console.error("verify_mailbox_sync_secret failed", {
          code: error.code,
        });
      } else {
        vaultOk = data === true;
      }
    }
    if (!vaultOk) {
      return new Response(JSON.stringify({ error: auth.error }), {
        status: auth.status,
      });
    }
  }

  const { data, error } = await service.rpc("list_mailboxes_due_for_sync", {
    p_limit: 20,
  });
  if (error) {
    console.error("list_mailboxes_due_for_sync failed", { code: error.code });
    return new Response(JSON.stringify({ error: "LIST_FAILED" }), {
      status: 500,
    });
  }

  const mailboxes = (Array.isArray(data) ? data : []) as Array<
    Record<string, unknown>
  >;
  const holder = `cron-${crypto.randomUUID()}`;
  const results = [];
  for (const row of mailboxes) {
    const id = String(row.id ?? "");
    if (!id) continue;
    const result = await runMailboxSyncCycle(id, `${holder}:${id}`);
    results.push({ mailbox_id: id, ...result });
  }

  return new Response(
    JSON.stringify({
      data: {
        scanned: mailboxes.length,
        results,
      },
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
});

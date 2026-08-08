/**
 * Edge cron entry for due recurring invoice schedules.
 * Invoke periodically (e.g. every 1–5m) with verify_jwt=false + internal secret.
 */
import { createClient } from "@supabase/supabase-js";
import { authorizeCronRequest } from "../_shared/cron-auth.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), {
      status: 405,
    });
  }

  const auth = authorizeCronRequest(req, {
    envSecret: Deno.env.get("RECURRING_INVOICES_CRON_SECRET"),
    headerName: "x-recurring-invoices-cron-secret",
    missingConfigLog:
      "RECURRING_INVOICES_CRON_SECRET is not configured; refusing to run",
  });
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
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

  const holder = `cron-${crypto.randomUUID()}`;
  const { data, error } = await service.rpc("process_due_recurring_schedules", {
    p_limit: 20,
    p_claimed_by: holder,
  });
  if (error) {
    console.error("process_due_recurring_schedules failed", {
      code: error.code,
      message: error.message,
    });
    return new Response(JSON.stringify({ error: "PROCESS_FAILED" }), {
      status: 500,
    });
  }

  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

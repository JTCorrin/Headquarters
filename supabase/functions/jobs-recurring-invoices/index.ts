/**
 * Edge cron entry for due recurring invoice schedules.
 * Invoke periodically (e.g. every 1–5m) with verify_jwt=false + internal secret.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../_shared/database.ts";
import { authorizeCronRequest } from "../_shared/cron-auth.ts";
import {
  InvoiceDocumentMailError,
  sendInvoiceDocumentEmail,
} from "../_shared/invoice-document-mail.ts";
import { buildInvoicePdfBytes } from "../_shared/invoice-pdf.ts";

type ServiceClient = SupabaseClient<Database>;

type DeliveryClaim = {
  run_id: string;
  org_id: string;
  invoice_id: string;
  invoice_version: number;
};

type DeliveryResult = {
  run_id: string;
  org_id: string;
  invoice_id: string;
  ok: boolean;
  status?: string;
  error_code?: string;
  error_message?: string;
  recipients?: string[];
};

function formatMoney(cents: number, currency: string): string {
  const amount = cents / 100;
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency })
      .format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function parseClaims(raw: Json | null): DeliveryClaim[] {
  if (!Array.isArray(raw)) return [];
  const claims: DeliveryClaim[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const runId = typeof row.run_id === "string" ? row.run_id : null;
    const orgId = typeof row.org_id === "string" ? row.org_id : null;
    const invoiceId = typeof row.invoice_id === "string" ? row.invoice_id : null;
    const invoiceVersion = typeof row.invoice_version === "number"
      ? row.invoice_version
      : null;
    if (!runId || !orgId || !invoiceId || invoiceVersion === null) continue;
    claims.push({
      run_id: runId,
      org_id: orgId,
      invoice_id: invoiceId,
      invoice_version: invoiceVersion,
    });
  }
  return claims;
}

function clientNameFromSnapshot(snapshot: Json | null): string | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return null;
  }
  const client = (snapshot as Record<string, unknown>).client;
  if (!client || typeof client !== "object" || Array.isArray(client)) return null;
  const name = (client as Record<string, unknown>).name;
  return typeof name === "string" && name.trim().length > 0 ? name.trim() : null;
}

async function processDeliveryClaim(
  service: ServiceClient,
  claim: DeliveryClaim,
  claimedBy: string,
): Promise<DeliveryResult> {
  const base = {
    run_id: claim.run_id,
    org_id: claim.org_id,
    invoice_id: claim.invoice_id,
  };

  try {
    const { data: invoice, error: invoiceError } = await service
      .from("invoices")
      .select(
        "id, org_id, number, client_id, due_on, issue_on, currency, subtotal_cents, discount_cents, tax_cents, total_cents, party_snapshot",
      )
      .eq("id", claim.invoice_id)
      .eq("org_id", claim.org_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (invoiceError) throw invoiceError;
    if (!invoice) {
      throw new InvoiceDocumentMailError("invoice_not_found", "Invoice not found");
    }

    const { data: lines, error: linesError } = await service
      .from("invoice_lines")
      .select(
        "description, quantity, discount_percent, total_cents, position",
      )
      .eq("invoice_id", claim.invoice_id)
      .eq("org_id", claim.org_id)
      .order("position")
      .order("id");
    if (linesError) throw linesError;

    const { data: recipientRows, error: recipientsError } = await service
      .from("invoice_recipients")
      .select("contact_id, position")
      .eq("invoice_id", claim.invoice_id)
      .eq("org_id", claim.org_id)
      .order("position");
    if (recipientsError) throw recipientsError;

    const contactIds = (recipientRows ?? [])
      .map((row) => row.contact_id)
      .filter((id): id is string => typeof id === "string");

    const toAddresses: string[] = [];
    if (contactIds.length > 0) {
      const { data: contacts, error: contactsError } = await service
        .from("contacts")
        .select("id, primary_email")
        .eq("org_id", claim.org_id)
        .in("id", contactIds)
        .is("deleted_at", null);
      if (contactsError) throw contactsError;
      const emailById = new Map<string, string>();
      for (const contact of contacts ?? []) {
        const email = contact.primary_email?.trim();
        if (email) emailById.set(contact.id, email);
      }
      for (const id of contactIds) {
        const email = emailById.get(id);
        if (email) toAddresses.push(email);
      }
    }

    const { data: org, error: orgError } = await service
      .from("organisations")
      .select("name, legal_name")
      .eq("id", claim.org_id)
      .maybeSingle();
    if (orgError) throw orgError;

    const { data: client, error: clientError } = await service
      .from("clients")
      .select("name")
      .eq("id", invoice.client_id)
      .eq("org_id", claim.org_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (clientError) throw clientError;

    const clientName = client?.name?.trim() ||
      clientNameFromSnapshot(invoice.party_snapshot) ||
      "Client";
    const orgName = org?.legal_name?.trim() || org?.name?.trim() || "Organisation";
    const invoiceNumber = invoice.number?.trim() || claim.invoice_id.slice(0, 8);
    const pdfFilename =
      `invoice-${invoiceNumber.replace(/[^a-zA-Z0-9._-]+/g, "-")}.pdf`;

    const pdfBytes = await buildInvoicePdfBytes({
      orgName,
      invoiceNumber,
      clientName,
      issueOn: invoice.issue_on,
      dueOn: invoice.due_on,
      currency: invoice.currency,
      lines: (lines ?? []).map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitLabel: null,
        discountPercent: line.discount_percent,
        totalCents: line.total_cents,
      })),
      subtotalCents: invoice.subtotal_cents,
      discountCents: invoice.discount_cents,
      taxCents: invoice.tax_cents,
      totalCents: invoice.total_cents,
    });

    const sent = await sendInvoiceDocumentEmail({
      service,
      orgId: claim.org_id,
      toAddresses,
      invoiceNumber,
      clientName,
      totalLabel: formatMoney(invoice.total_cents, invoice.currency),
      dueOn: invoice.due_on,
      orgName,
      pdfBytes,
      pdfFilename,
    });

    const { data: completed, error: completeError } = await service.rpc(
      "complete_recurring_invoice_delivery",
      {
        p_run_id: claim.run_id,
        p_org_id: claim.org_id,
      },
    );
    if (completeError) throw completeError;

    return {
      ...base,
      ok: true,
      status: typeof completed === "object" && completed !== null &&
          !Array.isArray(completed) &&
          typeof (completed as Record<string, unknown>).status === "string"
        ? String((completed as Record<string, unknown>).status)
        : "sent",
      recipients: sent.recipients,
    };
  } catch (error) {
    const errorCode = error instanceof InvoiceDocumentMailError
      ? error.code
      : "DELIVERY_FAILED";
    const errorMessage = error instanceof Error ? error.message : "Delivery failed";

    const { error: failError } = await service.rpc(
      "fail_recurring_invoice_delivery",
      {
        p_run_id: claim.run_id,
        p_org_id: claim.org_id,
        p_error_code: errorCode,
        p_error_message: errorMessage,
      },
    );
    if (failError) {
      console.error("fail_recurring_invoice_delivery failed", {
        claimed_by: claimedBy,
        run_id: claim.run_id,
        code: failError.code,
        message: failError.message,
      });
    }

    return {
      ...base,
      ok: false,
      status: "delivery_failed",
      error_code: errorCode,
      error_message: errorMessage,
    };
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), {
      status: 405,
    });
  }

  const auth = authorizeCronRequest(req, {
    envSecret: Deno.env.get("RECURRING_INVOICES_CRON_SECRET"),
    headerName: "x-recurring-invoices-cron-secret",
    serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    missingConfigLog:
      "RECURRING_INVOICES_CRON_SECRET and SUPABASE_SERVICE_ROLE_KEY are unset; refusing to run",
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

  const service = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const holder = `cron-${crypto.randomUUID()}`;
  const { data: scheduleData, error } = await service.rpc(
    "process_due_recurring_schedules",
    {
      p_limit: 20,
      p_claimed_by: holder,
    },
  );
  if (error) {
    console.error("process_due_recurring_schedules failed", {
      code: error.code,
      message: error.message,
    });
    return new Response(JSON.stringify({ error: "PROCESS_FAILED" }), {
      status: 500,
    });
  }

  const { data: claimedRaw, error: claimError } = await service.rpc(
    "claim_recurring_invoice_deliveries",
    {
      p_limit: 20,
      p_claimed_by: holder,
    },
  );
  if (claimError) {
    console.error("claim_recurring_invoice_deliveries failed", {
      code: claimError.code,
      message: claimError.message,
    });
    return new Response(JSON.stringify({ error: "DELIVERY_CLAIM_FAILED" }), {
      status: 500,
    });
  }

  const claims = parseClaims(claimedRaw as Json);
  const deliveries: DeliveryResult[] = [];
  for (const claim of claims) {
    deliveries.push(await processDeliveryClaim(service, claim, holder));
  }

  return new Response(
    JSON.stringify({
      data: {
        schedules: scheduleData,
        deliveries,
      },
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
});

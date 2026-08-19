import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ClientContactRow,
  ClientRow,
  Database,
  Json,
} from "../_shared/database.ts";
import {
  ApiError,
  etag,
  jsonBody,
  jsonResponse,
  parseLimit,
  parseUuid,
  parseVersion,
} from "./http.ts";

const CLIENT_SELECT =
  "id,org_id,created_at,updated_at,created_by,updated_by,deleted_at,version,name,status,website_url,industry,primary_email,phone,tax_identifier,tax_exempt,email_domain,registration_number,default_currency,payment_terms_days,owner_membership_id,converted_from_lead_id,renewal_on,notes,metadata";

const WRITABLE_FIELDS = new Set([
  "name",
  "status",
  "website_url",
  "industry",
  "primary_email",
  "phone",
  "tax_identifier",
  "tax_exempt",
  "email_domain",
  "registration_number",
  "default_currency",
  "payment_terms_days",
  "owner_membership_id",
  "renewal_on",
  "notes",
  "metadata",
]);

const NULLABLE_TEXT_FIELDS = [
  "website_url",
  "industry",
  "primary_email",
  "phone",
  "tax_identifier",
  "email_domain",
  "registration_number",
  "notes",
] as const;

const TEXT_LIMITS: Record<(typeof NULLABLE_TEXT_FIELDS)[number], number> = {
  website_url: 2000,
  industry: 120,
  primary_email: 320,
  phone: 64,
  tax_identifier: 120,
  email_domain: 255,
  registration_number: 120,
  notes: 20_000,
};

const STATUSES = new Set([
  "prospect",
  "active",
  "on_hold",
  "inactive",
  "archived",
]);

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "yandex.ru",
]);

type DatabaseClient = SupabaseClient<Database>;

export type ClientLinkedContact = {
  id: string;
  display_name: string;
  primary_email: string | null;
  role: ClientContactRow["role"];
  is_primary: boolean;
};

type ClientWithContacts = ClientRow & { contacts: ClientLinkedContact[] };

function sortClientLinkedContacts(
  people: ClientLinkedContact[],
): ClientLinkedContact[] {
  return [...people].sort((a, b) => {
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    return a.display_name.localeCompare(b.display_name);
  });
}

async function loadLinkedContactsByClientIds(
  db: DatabaseClient,
  orgId: string,
  clientIds: string[],
  requestId: string,
): Promise<Map<string, ClientLinkedContact[]>> {
  const map = new Map<string, ClientLinkedContact[]>();
  for (const id of clientIds) map.set(id, []);
  if (clientIds.length === 0) return map;

  const { data: links, error: linkError } = await db
    .from("client_contacts")
    .select("client_id, contact_id, role, is_primary")
    .eq("org_id", orgId)
    .in("client_id", clientIds)
    .is("deleted_at", null);

  if (linkError) throw databaseError(linkError, requestId);
  if (!links?.length) return map;

  const contactIds = [...new Set(links.map((row) => row.contact_id))];
  const { data: contacts, error: contactError } = await db
    .from("contacts")
    .select("id, display_name, primary_email")
    .eq("org_id", orgId)
    .in("id", contactIds)
    .is("deleted_at", null);

  if (contactError) throw databaseError(contactError, requestId);

  const byId = new Map((contacts ?? []).map((contact) => [contact.id, contact]));
  for (const link of links) {
    const contact = byId.get(link.contact_id);
    if (!contact) continue;
    map.get(link.client_id)?.push({
      id: contact.id,
      display_name: contact.display_name,
      primary_email: contact.primary_email,
      role: link.role,
      is_primary: link.is_primary,
    });
  }

  for (const [clientId, people] of map) {
    map.set(clientId, sortClientLinkedContacts(people));
  }
  return map;
}

async function withLinkedContacts(
  db: DatabaseClient,
  orgId: string,
  clients: ClientRow[],
  requestId: string,
): Promise<ClientWithContacts[]> {
  const linked = await loadLinkedContactsByClientIds(
    db,
    orgId,
    clients.map((client) => client.id),
    requestId,
  );
  return clients.map((client) => ({
    ...client,
    contacts: linked.get(client.id) ?? [],
  }));
}

type ClientStatus = ClientRow["status"];
type ClientWritable = {
  name?: string;
  status?: ClientStatus;
  website_url?: string | null;
  industry?: string | null;
  primary_email?: string | null;
  phone?: string | null;
  tax_identifier?: string | null;
  tax_exempt?: boolean;
  email_domain?: string | null;
  registration_number?: string | null;
  default_currency?: string | null;
  payment_terms_days?: number | null;
  owner_membership_id?: string | null;
  renewal_on?: string | null;
  notes?: string | null;
  metadata?: Json;
};
type ClientCreate = ClientWritable & { name: string; status: ClientStatus };
type ClientUpdate = ClientWritable;

interface ClientCursor {
  created_at: string;
  id: string;
}

interface DatabaseError {
  code?: string;
  message?: string;
}

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function validateClientBody(
  body: Record<string, unknown>,
  partial: false,
): ClientCreate;
export function validateClientBody(
  body: Record<string, unknown>,
  partial: true,
): ClientUpdate;
export function validateClientBody(
  body: Record<string, unknown>,
  partial: boolean,
): ClientCreate | ClientUpdate {
  const fields: Record<string, string> = {};
  const output: ClientUpdate = {};

  for (const key of Object.keys(body)) {
    if (!WRITABLE_FIELDS.has(key)) fields[key] = "Field is not writable";
  }

  if (!partial || "name" in body) {
    const value = body.name;
    if (
      typeof value !== "string" || value.trim().length < 1 ||
      value.trim().length > 200
    ) {
      fields.name = "Must be a string between 1 and 200 characters";
    } else {
      output.name = value.trim();
    }
  }

  for (const field of NULLABLE_TEXT_FIELDS) {
    if (!(field in body)) continue;
    const value = body[field];
    if (value !== null && typeof value !== "string") {
      fields[field] = "Must be a string or null";
    } else if (
      typeof value === "string" && value.trim().length > TEXT_LIMITS[field]
    ) {
      fields[field] = `Must not exceed ${TEXT_LIMITS[field]} characters`;
    } else {
      output[field] = typeof value === "string" ? value.trim() || null : null;
    }
  }

  if ("primary_email" in output && typeof output.primary_email === "string") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(output.primary_email)) {
      fields.primary_email = "Must be a valid email address";
    }
  }

  if ("email_domain" in output && typeof output.email_domain === "string") {
    const host = output.email_domain.toLowerCase().replace(/^@+/, "").replace(
      /^www\./,
      "",
    );
    output.email_domain = host;
    if (
      !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/
        .test(host)
    ) {
      fields.email_domain = "Must be a domain like hesis.co.uk";
    } else if (PUBLIC_EMAIL_DOMAINS.has(host)) {
      fields.email_domain = "Public mailbox domains cannot be used";
    }
  }

  if ("owner_membership_id" in body) {
    const value = body.owner_membership_id;
    if (value === null) {
      output.owner_membership_id = null;
    } else {
      try {
        output.owner_membership_id = parseUuid(
          typeof value === "string" ? value : null,
          "owner_membership_id",
        );
      } catch {
        fields.owner_membership_id = "Must be a UUID or null";
      }
    }
  }

  if ("status" in body) {
    const value = body.status;
    if (typeof value !== "string" || !STATUSES.has(value)) {
      fields.status =
        "Must be prospect, active, on_hold, inactive, or archived";
    } else {
      output.status = value as ClientStatus;
    }
  } else if (!partial) {
    output.status = "active";
  }

  if ("tax_exempt" in body) {
    const value = body.tax_exempt;
    if (typeof value !== "boolean") {
      fields.tax_exempt = "Must be a boolean";
    } else {
      output.tax_exempt = value;
    }
  } else if (!partial) {
    output.tax_exempt = false;
  }

  if ("default_currency" in body) {
    const value = body.default_currency;
    if (
      value !== null && (typeof value !== "string" || !/^[A-Z]{3}$/.test(value))
    ) {
      fields.default_currency =
        "Must be a 3-letter uppercase ISO currency code or null";
    } else {
      output.default_currency = value as string | null;
    }
  }

  if ("payment_terms_days" in body) {
    const value = body.payment_terms_days;
    if (
      value !== null &&
      (typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > 3650)
    ) {
      fields.payment_terms_days =
        "Must be a safe integer between 0 and 3650, or null";
    } else {
      output.payment_terms_days = value as number | null;
    }
  }

  if ("renewal_on" in body) {
    const value = body.renewal_on;
    if (value === null) {
      output.renewal_on = null;
    } else if (typeof value !== "string" || !isValidDateOnly(value)) {
      fields.renewal_on = "Must be a real YYYY-MM-DD date or null";
    } else {
      output.renewal_on = value;
    }
  }

  if ("metadata" in body) {
    const value = body.metadata;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      fields.metadata = "Must be a JSON object";
    } else if (
      new TextEncoder().encode(JSON.stringify(value)).byteLength > 16_384
    ) {
      fields.metadata = "Must not exceed 16 KiB";
    } else {
      output.metadata = value as Json;
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Client validation failed",
      fields,
    );
  }
  if (partial && Object.keys(output).length === 0) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "At least one writable field is required",
    );
  }

  return output as ClientCreate | ClientUpdate;
}

function encodeCursor(client: ClientCursor): string {
  return btoa(JSON.stringify({ created_at: client.created_at, id: client.id }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function decodeClientCursor(value: string): ClientCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url");
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const cursor = JSON.parse(atob(`${base64}${padding}`)) as Partial<
      ClientCursor
    >;
    const createdAt = cursor.created_at;
    const id = parseUuid(cursor.id ?? null, "cursor");
    if (
      typeof createdAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/
        .test(
          createdAt,
        ) ||
      Number.isNaN(Date.parse(createdAt))
    ) {
      throw new Error("Invalid timestamp");
    }
    return { created_at: createdAt, id };
  } catch {
    throw new ApiError(400, "BAD_REQUEST", "cursor is invalid", {
      cursor: "Must be a cursor returned by this endpoint",
    });
  }
}

function databaseError(error: DatabaseError, requestId: string): ApiError {
  if (error.message?.toLowerCase().includes("version conflict")) {
    return new ApiError(
      412,
      "PRECONDITION_FAILED",
      "Client version does not match If-Match",
    );
  }
  if (error.code === "23505") {
    return new ApiError(
      409,
      "CONFLICT",
      "The client conflicts with an existing record",
    );
  }
  if (error.code === "23503") {
    return new ApiError(
      422,
      "VALIDATION_ERROR",
      "A referenced record is invalid",
    );
  }
  if (error.code === "23514" || error.code === "22023") {
    return new ApiError(
      422,
      "VALIDATION_ERROR",
      "The client failed a database constraint",
    );
  }
  if (error.code === "42501") {
    return new ApiError(403, "FORBIDDEN", "This action is not permitted");
  }
  if (error.code === "P0002") {
    return new ApiError(404, "NOT_FOUND", "Client not found");
  }
  console.error("Client database operation failed", {
    request_id: requestId,
    code: error.code ?? "unknown",
  });
  return new ApiError(500, "INTERNAL_ERROR", "The client operation failed");
}

async function listClients(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const url = new URL(req.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const status = url.searchParams.get("status");
  if (status && !STATUSES.has(status)) {
    throw new ApiError(400, "BAD_REQUEST", "status is invalid");
  }

  let query = db
    .from("clients")
    .select(CLIENT_SELECT)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (status) {
    query = query.eq("status", status as ClientStatus);
  }

  const cursorValue = url.searchParams.get("cursor");
  if (cursorValue) {
    const cursor = decodeClientCursor(cursorValue);
    query = query.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) throw databaseError(error, requestId);

  const clients = (data ?? []) as ClientRow[];
  const hasNextPage = clients.length > limit;
  const page = hasNextPage ? clients.slice(0, limit) : clients;
  const lastClient = page.at(-1) as ClientCursor | undefined;
  const withContacts = await withLinkedContacts(db, orgId, page, requestId);

  return jsonResponse(
    {
      data: withContacts,
      meta: {
        next_cursor: hasNextPage && lastClient
          ? encodeCursor(lastClient)
          : null,
      },
    },
    200,
    requestId,
  );
}

async function createClient(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const payload = validateClientBody(await jsonBody(req), false);
  const { data, error } = await db
    .from("clients")
    .insert({ ...payload, org_id: orgId })
    .select(CLIENT_SELECT)
    .single();

  if (error) throw databaseError(error, requestId);

  const [withContacts] = await withLinkedContacts(db, orgId, [data], requestId);
  return jsonResponse({ data: withContacts }, 201, requestId, {
    etag: etag(data.version),
    location: `/api/v1/clients/${data.id}`,
  });
}

async function findClient(
  db: DatabaseClient,
  orgId: string,
  clientId: string,
  requestId: string,
): Promise<ClientRow> {
  const { data, error } = await db
    .from("clients")
    .select(CLIENT_SELECT)
    .eq("org_id", orgId)
    .eq("id", clientId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw databaseError(error, requestId);
  if (!data) throw new ApiError(404, "NOT_FOUND", "Client not found");
  return data;
}

async function getClient(
  db: DatabaseClient,
  orgId: string,
  clientId: string,
  requestId: string,
): Promise<Response> {
  const data = await findClient(db, orgId, clientId, requestId);
  const [withContacts] = await withLinkedContacts(db, orgId, [data], requestId);
  return jsonResponse({ data: withContacts }, 200, requestId, {
    etag: etag(data.version),
  });
}

async function updateClient(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  clientId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req);
  const current = await findClient(db, orgId, clientId, requestId);
  if (current.version !== version) {
    throw new ApiError(
      412,
      "PRECONDITION_FAILED",
      "Client version does not match If-Match",
    );
  }

  const payload = validateClientBody(await jsonBody(req), true);
  const { data, error } = await db
    .from("clients")
    .update(payload)
    .eq("org_id", orgId)
    .eq("id", clientId)
    .eq("version", version)
    .is("deleted_at", null)
    .select(CLIENT_SELECT)
    .maybeSingle();

  if (error) throw databaseError(error, requestId);
  if (!data) {
    throw new ApiError(
      412,
      "PRECONDITION_FAILED",
      "Client changed during this request",
    );
  }

  const [withContacts] = await withLinkedContacts(db, orgId, [data], requestId);
  return jsonResponse({ data: withContacts }, 200, requestId, {
    etag: etag(data.version),
  });
}

async function deleteClient(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  clientId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req);
  // Direct UPDATE ... deleted_at hits RLS 42501 for authenticated callers on
  // staging; mutate through the security-definer RPC (same pattern as contacts).
  const { error } = await db.rpc("soft_delete_client", {
    p_client_id: clientId,
    p_org_id: orgId,
    p_expected_version: version,
  });

  if (error) throw databaseError(error, requestId);

  return new Response(null, {
    status: 204,
    headers: { "x-request-id": requestId },
  });
}

export function handleClients(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  requestId: string,
): Promise<Response> {
  if (path === "/api/v1/clients") {
    if (req.method === "GET") return listClients(req, db, orgId, requestId);
    if (req.method === "POST") return createClient(req, db, orgId, requestId);
    throw new ApiError(
      405,
      "METHOD_NOT_ALLOWED",
      "Method not allowed for clients",
    );
  }

  const itemMatch = path.match(
    /^\/api\/v1\/clients\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  );
  if (!itemMatch) throw new ApiError(404, "NOT_FOUND", "Route not found");

  const clientId = itemMatch[1];
  if (req.method === "GET") return getClient(db, orgId, clientId, requestId);
  if (req.method === "PATCH") {
    return updateClient(req, db, orgId, clientId, requestId);
  }
  if (req.method === "DELETE") {
    return deleteClient(req, db, orgId, clientId, requestId);
  }
  throw new ApiError(
    405,
    "METHOD_NOT_ALLOWED",
    "Method not allowed for client",
  );
}

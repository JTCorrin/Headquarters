import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../_shared/database.ts";
import { sendSystemInvitationEmail } from "../_shared/system-email.ts";
import { sha256Hex } from "./api-keys.ts";
import { ApiError, jsonBody, jsonResponse, parseUuid } from "./http.ts";

type DatabaseClient = SupabaseClient<Database>;
type MembershipRole =
  Database["public"]["Tables"]["memberships"]["Row"]["role"];
type InvitationRole = Exclude<MembershipRole, "owner">;

const INVITATION_ROLES = new Set<InvitationRole>([
  "admin",
  "member",
  "billing",
  "readonly",
]);
const MEMBER_STATUSES = new Set(["active", "suspended"]);

function databaseError(
  error: { code?: string; message?: string },
  requestId: string,
): ApiError {
  const message = error.message?.toLowerCase() ?? "";
  if (error.code === "42501" || message.includes("forbidden")) {
    return new ApiError(
      403,
      "FORBIDDEN",
      error.message ?? "Organisation access is forbidden",
    );
  }
  if (
    error.code === "P0002" || message.includes("not found") ||
    message.includes("expired")
  ) {
    return new ApiError(
      404,
      "NOT_FOUND",
      error.message ?? "Resource not found",
    );
  }
  if (error.code === "23505") {
    return new ApiError(
      409,
      "CONFLICT",
      error.message ?? "The operation conflicts with existing data",
    );
  }
  if (
    error.code === "22023" || error.code === "23514" ||
    message.includes("invalid")
  ) {
    return new ApiError(
      422,
      "VALIDATION_ERROR",
      error.message ?? "Validation failed",
    );
  }
  console.error("Organisation access operation failed", {
    request_id: requestId,
    code: error.code ?? "unknown",
  });
  return new ApiError(
    500,
    "INTERNAL_ERROR",
    "The organisation access operation failed",
  );
}

function randomInvitationToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `crm_inv_${
    [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  }`;
}

function invitationInput(body: Record<string, unknown>): {
  email: string;
  role: InvitationRole;
  expires_at: string;
} {
  const fields: Record<string, string> = {};
  const writable = new Set(["email", "role", "expires_at"]);
  for (const key of Object.keys(body)) {
    if (!writable.has(key)) fields[key] = "Unknown field";
  }
  const email = typeof body.email === "string"
    ? body.email.trim().toLowerCase()
    : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    fields.email = "Must be a valid email address";
  }
  const role = body.role;
  if (
    typeof role !== "string" || !INVITATION_ROLES.has(role as InvitationRole)
  ) {
    fields.role = "Must be admin, member, billing, or readonly";
  }
  let expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  if ("expires_at" in body) {
    if (
      typeof body.expires_at !== "string" ||
      Number.isNaN(Date.parse(body.expires_at))
    ) {
      fields.expires_at = "Must be a future ISO-8601 timestamp";
    } else {
      expiresAt = new Date(body.expires_at).toISOString();
      if (Date.parse(expiresAt) <= Date.now()) {
        fields.expires_at = "Must be in the future";
      }
    }
  }
  if (Object.keys(fields).length > 0) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Invitation validation failed",
      fields,
    );
  }
  return { email, role: role as InvitationRole, expires_at: expiresAt };
}

async function createInvitation(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const input = invitationInput(await jsonBody(req));
  const token = randomInvitationToken();
  const tokenHash = await sha256Hex(token);
  const { data, error } = await db.rpc("create_organisation_invitation", {
    p_org_id: orgId,
    p_email: input.email,
    p_role: input.role,
    p_token_hash: tokenHash,
    p_expires_at: input.expires_at,
  });
  if (error) throw databaseError(error, requestId);

  const [{ data: organisation }, { data: profile }] = await Promise.all([
    db.from("organisations").select("name").eq("id", orgId).single(),
    db.from("profiles").select("display_name").eq(
      "id",
      (data as { invited_by: string }).invited_by,
    )
      .single(),
  ]);
  try {
    await sendSystemInvitationEmail({
      to: input.email,
      organisationName: organisation?.name ?? "your organisation",
      inviterName: profile?.display_name ?? "An administrator",
      role: input.role,
      token,
      expiresAt: input.expires_at,
    });
  } catch (emailError) {
    const invitationId = (data as { id?: string } | null)?.id;
    if (invitationId) {
      await db.rpc("revoke_organisation_invitation", {
        p_org_id: orgId,
        p_invitation_id: invitationId,
      });
    }
    console.error("System invitation email failed", {
      request_id: requestId,
      error: emailError instanceof Error ? emailError.message : "unknown",
    });
    throw new ApiError(
      502,
      "UPSTREAM_ERROR",
      "Invitation email could not be delivered",
    );
  }

  return jsonResponse({ data }, 201, requestId);
}

async function acceptInvitation(
  req: Request,
  db: DatabaseClient,
  requestId: string,
): Promise<Response> {
  const body = await jsonBody(req);
  if (
    Object.keys(body).some((key) => key !== "token") ||
    typeof body.token !== "string" ||
    !/^crm_inv_[0-9a-f]{64}$/.test(body.token)
  ) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "A valid invitation token is required",
      {
        token: "Must be an invitation token",
      },
    );
  }
  const { data, error } = await db.rpc("accept_organisation_invitation", {
    p_token_hash: await sha256Hex(body.token),
  });
  if (error) throw databaseError(error, requestId);
  return jsonResponse({ data }, 200, requestId);
}

function memberPatch(body: Record<string, unknown>): {
  role: InvitationRole | null;
  status: "active" | "suspended" | null;
} {
  const fields: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (key !== "role" && key !== "status") fields[key] = "Unknown field";
  }
  let role: InvitationRole | null = null;
  let status: "active" | "suspended" | null = null;
  if ("role" in body) {
    if (
      typeof body.role !== "string" ||
      !INVITATION_ROLES.has(body.role as InvitationRole)
    ) {
      fields.role = "Must be admin, member, billing, or readonly";
    } else role = body.role as InvitationRole;
  }
  if ("status" in body) {
    if (typeof body.status !== "string" || !MEMBER_STATUSES.has(body.status)) {
      fields.status = "Must be active or suspended";
    } else status = body.status as "active" | "suspended";
  }
  if (role === null && status === null) fields._ = "Role or status is required";
  if (Object.keys(fields).length > 0) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Member validation failed",
      fields,
    );
  }
  return { role, status };
}

export async function handleOrganisationAccess(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  actorRole: MembershipRole,
  requestId: string,
): Promise<Response> {
  if (actorRole !== "owner" && actorRole !== "admin") {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Only owners and admins can manage organisation access",
    );
  }
  if (path === "/api/v1/organisation/invitations") {
    if (req.method === "GET") {
      const { data, error } = await db.rpc("list_organisation_invitations", {
        p_org_id: orgId,
      });
      if (error) throw databaseError(error, requestId);
      return jsonResponse({ data: (data ?? []) as Json }, 200, requestId);
    }
    if (req.method === "POST") {
      return await createInvitation(req, db, orgId, requestId);
    }
    throw new ApiError(
      405,
      "METHOD_NOT_ALLOWED",
      "Method not allowed for invitations",
    );
  }

  const invitationMatch = path.match(
    /^\/api\/v1\/organisation\/invitations\/([0-9a-f-]{36})$/i,
  );
  if (invitationMatch) {
    if (req.method !== "DELETE") {
      throw new ApiError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for invitation",
      );
    }
    const { data, error } = await db.rpc("revoke_organisation_invitation", {
      p_org_id: orgId,
      p_invitation_id: parseUuid(invitationMatch[1], "id"),
    });
    if (error) throw databaseError(error, requestId);
    return jsonResponse({ data }, 200, requestId);
  }

  if (path === "/api/v1/organisation/members") {
    if (req.method !== "GET") {
      throw new ApiError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for members",
      );
    }
    const { data, error } = await db.rpc("list_organisation_members", {
      p_org_id: orgId,
    });
    if (error) throw databaseError(error, requestId);
    return jsonResponse({ data: (data ?? []) as Json }, 200, requestId);
  }

  const transferMatch = path.match(
    /^\/api\/v1\/organisation\/members\/([0-9a-f-]{36})\/transfer-ownership$/i,
  );
  if (transferMatch) {
    if (req.method !== "POST") {
      throw new ApiError(
        405,
        "METHOD_NOT_ALLOWED",
        "Method not allowed for ownership transfer",
      );
    }
    const { data, error } = await db.rpc("transfer_organisation_ownership", {
      p_org_id: orgId,
      p_target_membership_id: parseUuid(transferMatch[1], "id"),
    });
    if (error) throw databaseError(error, requestId);
    return jsonResponse({ data }, 200, requestId);
  }

  const memberMatch = path.match(
    /^\/api\/v1\/organisation\/members\/([0-9a-f-]{36})$/i,
  );
  if (memberMatch) {
    const membershipId = parseUuid(memberMatch[1], "id");
    if (req.method === "PATCH") {
      const input = memberPatch(await jsonBody(req));
      const { data, error } = await db.rpc("update_organisation_member", {
        p_org_id: orgId,
        p_membership_id: membershipId,
        p_role: input.role,
        p_status: input.status,
      });
      if (error) throw databaseError(error, requestId);
      return jsonResponse({ data }, 200, requestId);
    }
    if (req.method === "DELETE") {
      const { error } = await db.rpc("remove_organisation_member", {
        p_org_id: orgId,
        p_membership_id: membershipId,
      });
      if (error) throw databaseError(error, requestId);
      return new Response(null, {
        status: 204,
        headers: { "x-request-id": requestId },
      });
    }
    throw new ApiError(
      405,
      "METHOD_NOT_ALLOWED",
      "Method not allowed for member",
    );
  }

  throw new ApiError(404, "NOT_FOUND", "Route not found");
}

export { acceptInvitation };

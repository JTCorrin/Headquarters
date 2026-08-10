import {
  generateOutboundMessageId,
  sendSmtpMail,
  type SmtpSecurity,
} from "./smtp-outbound.ts";

export type SystemInvitationEmail = {
  to: string;
  organisationName: string;
  inviterName: string;
  role: string;
  token: string;
  expiresAt: string;
};

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function optionalEnv(name: string): string {
  return Deno.env.get(name)?.trim() ?? "";
}

function systemSmtpConfig(): {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  password: string;
  from: string;
  appBaseUrl: string;
} {
  const security =
    (Deno.env.get("SYSTEM_SMTP_SECURITY") ?? "starttls") as SmtpSecurity;
  if (!["tls", "starttls", "none"].includes(security)) {
    throw new Error("SYSTEM_SMTP_SECURITY must be tls, starttls, or none");
  }
  const port = Number(
    Deno.env.get("SYSTEM_SMTP_PORT") ?? (security === "tls" ? "465" : "587"),
  );
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SYSTEM_SMTP_PORT is invalid");
  }
  return {
    host: requiredEnv("SYSTEM_SMTP_HOST"),
    port,
    security,
    username: optionalEnv("SYSTEM_SMTP_USERNAME"),
    password: optionalEnv("SYSTEM_SMTP_PASSWORD"),
    from: requiredEnv("SYSTEM_SMTP_FROM"),
    appBaseUrl: requiredEnv("APP_BASE_URL").replace(/\/+$/, ""),
  };
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
}

export function invitationEmailContent(
  input: SystemInvitationEmail,
  appBaseUrl: string,
): {
  subject: string;
  bodyText: string;
  bodyHtml: string;
  acceptUrl: string;
} {
  const acceptUrl = `${
    appBaseUrl.replace(/\/+$/, "")
  }/invite/accept?token=${encodeURIComponent(input.token)}`;
  const subject = `You're invited to ${input.organisationName}`;
  const expiry = new Date(input.expiresAt).toUTCString();
  const bodyText = [
    `${input.inviterName} invited you to join ${input.organisationName} as ${input.role}.`,
    "",
    `Accept the invitation: ${acceptUrl}`,
    "",
    `This one-time invitation expires ${expiry}. Sign in with ${input.to} to accept it.`,
  ].join("\n");
  const bodyHtml = [
    `<p>${escapeHtml(input.inviterName)} invited you to join <strong>${
      escapeHtml(input.organisationName)
    }</strong> as ${escapeHtml(input.role)}.</p>`,
    `<p><a href="${escapeHtml(acceptUrl)}">Accept invitation</a></p>`,
    `<p>This one-time invitation expires ${escapeHtml(expiry)}. Sign in with ${
      escapeHtml(input.to)
    } to accept it.</p>`,
  ].join("");
  return { subject, bodyText, bodyHtml, acceptUrl };
}

export async function sendSystemInvitationEmail(
  input: SystemInvitationEmail,
): Promise<void> {
  const config = systemSmtpConfig();
  const content = invitationEmailContent(input, config.appBaseUrl);
  await sendSmtpMail({
    host: config.host,
    port: config.port,
    security: config.security,
    username: config.username,
    password: config.password,
    from: config.from,
    to: input.to,
    subject: content.subject,
    bodyText: content.bodyText,
    bodyHtml: content.bodyHtml,
    messageId: generateOutboundMessageId(config.from),
    allowPrivateHost: true,
  });
}

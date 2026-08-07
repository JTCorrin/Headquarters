/**
 * Minimal Deno CalDAV client for HQ → Mailcow/SOGo push.
 * Reuses IMAP SSRF policy via assertSafeOutboundHost.
 */

import {
  assertSafeOutboundHost,
  ImapSyncError,
  isSyntheticImapHost,
} from "./imap-inbound.ts";
import { isCalendarSyncStubMode } from "./google-calendar.ts";

export type CaldavSecretBlob = {
  password?: string;
  stub?: boolean;
};

export type CaldavEventInput = {
  title: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  location?: string | null;
  meeting_url?: string | null;
  description?: string | null;
  uid: string;
};

export type CaldavClient = {
  putEvent: (event: CaldavEventInput) => Promise<{ id: string }>;
  deleteEvent: (eventId: string) => Promise<void>;
  propfind: () => Promise<void>;
};

export class CaldavError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CaldavError";
  }
}

export function isSyntheticCaldavHost(host: string): boolean {
  return isSyntheticImapHost(host);
}

/** True when CALENDAR_SYNC_STAGING_STUB or CALDAV_SYNC_STAGING_STUB is set. */
export function isCaldavSyncStubMode(
  getEnv: (key: string) => string | undefined = (key) => Deno.env.get(key),
): boolean {
  if (isCalendarSyncStubMode(getEnv)) return true;
  const flag = (getEnv("CALDAV_SYNC_STAGING_STUB") ?? "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

export function parseCaldavSecretBlob(raw: string): CaldavSecretBlob {
  try {
    const parsed = JSON.parse(raw) as CaldavSecretBlob;
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // treat as opaque password string
  }
  return { password: raw };
}

export function serializeCaldavSecretBlob(blob: CaldavSecretBlob): string {
  return JSON.stringify(blob);
}

export function hostnameFromCaldavUrl(caldavUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(caldavUrl.trim());
  } catch {
    throw new CaldavError("caldav_url_invalid", "CalDAV URL is invalid");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new CaldavError("caldav_url_invalid", "CalDAV URL must be http(s)");
  }
  const host = parsed.hostname.trim();
  if (!host) {
    throw new CaldavError("caldav_url_invalid", "CalDAV URL hostname is empty");
  }
  return host;
}

/** Escape text for iCalendar TEXT values (RFC 5545). */
export function icsEscapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/** Format an ISO timestamp as UTC iCalendar DATE-TIME. */
export function toIcsUtcDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new CaldavError("caldav_event_invalid", "Invalid event timestamp");
  }
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const mo = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  const h = d.getUTCHours().toString().padStart(2, "0");
  const mi = d.getUTCMinutes().toString().padStart(2, "0");
  const s = d.getUTCSeconds().toString().padStart(2, "0");
  return `${y}${mo}${day}T${h}${mi}${s}Z`;
}

export function buildVeventIcs(event: CaldavEventInput): string {
  const descriptionParts: string[] = [];
  if (event.meeting_url) {
    descriptionParts.push(`Meeting URL: ${event.meeting_url}`);
  }
  if (event.description) descriptionParts.push(event.description);
  const description = descriptionParts.length > 0
    ? descriptionParts.join("\n\n")
    : null;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//HQ CRM//CalDAV//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${toIcsUtcDateTime(new Date().toISOString())}`,
    `DTSTART:${toIcsUtcDateTime(event.starts_at)}`,
    `DTEND:${toIcsUtcDateTime(event.ends_at)}`,
    `SUMMARY:${icsEscapeText(event.title)}`,
  ];
  if (event.location) {
    lines.push(`LOCATION:${icsEscapeText(event.location)}`);
  }
  if (description) {
    lines.push(`DESCRIPTION:${icsEscapeText(description)}`);
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export function eventObjectUrl(caldavUrl: string, eventId: string): string {
  const base = caldavUrl.trim().replace(/\/+$/, "");
  const id = eventId.trim().replace(/^\/+|\/+$/g, "");
  if (!id) {
    throw new CaldavError("caldav_event_invalid", "Event id is empty");
  }
  // Prefer href-shaped ids stored from a prior PUT; else UID.ics under collection.
  if (id.startsWith("http://") || id.startsWith("https://")) {
    return id;
  }
  if (id.includes("/")) {
    // Relative href under the same origin — join carefully.
    try {
      return new URL(id, base.endsWith("/") ? base : `${base}/`).toString();
    } catch {
      // fall through to UID path
    }
  }
  const filename = id.endsWith(".ics") ? id : `${id}.ics`;
  return `${base}/${filename}`;
}

function basicAuthHeader(username: string, password: string): string {
  const token = btoa(unescape(encodeURIComponent(`${username}:${password}`)));
  return `Basic ${token}`;
}

export function createStubCaldavClient(
  meetingIdForStub?: string,
): CaldavClient {
  return {
    putEvent(event) {
      const id = event.uid || meetingIdForStub || crypto.randomUUID();
      return Promise.resolve({
        id: id.startsWith("stub-") ? id : `stub-${id}`,
      });
    },
    deleteEvent(_eventId) {
      return Promise.resolve();
    },
    propfind() {
      return Promise.resolve();
    },
  };
}

export type LiveCaldavClientOptions = {
  caldavUrl: string;
  username: string;
  password: string;
  fetchImpl?: typeof fetch;
  resolveDns?: Parameters<typeof assertSafeOutboundHost>[1];
};

const CALDAV_MAX_REDIRECTS = 5;

export async function createLiveCaldavClient(
  options: LiveCaldavClientOptions,
): Promise<CaldavClient> {
  const host = hostnameFromCaldavUrl(options.caldavUrl);
  try {
    await assertSafeOutboundHost(host, options.resolveDns);
  } catch (err) {
    if (err instanceof ImapSyncError) {
      throw new CaldavError("caldav_host_blocked", err.message);
    }
    throw err;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const auth = basicAuthHeader(options.username, options.password);
  const collectionUrl = options.caldavUrl.trim().replace(/\/+$/, "") + "/";

  async function assertSafeUrl(url: string): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new CaldavError("caldav_host_blocked", "CalDAV URL is invalid");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new CaldavError(
        "caldav_host_blocked",
        "CalDAV URL scheme is not allowed",
      );
    }
    try {
      await assertSafeOutboundHost(parsed.hostname, options.resolveDns);
    } catch (err) {
      if (err instanceof ImapSyncError) {
        throw new CaldavError("caldav_host_blocked", err.message);
      }
      throw err;
    }
  }

  async function request(
    method: string,
    url: string,
    init: { body?: string; contentType?: string; depth?: string } = {},
  ): Promise<Response> {
    let current = url;
    for (let hop = 0; hop <= CALDAV_MAX_REDIRECTS; hop++) {
      await assertSafeUrl(current);
      const headers: Record<string, string> = {
        authorization: auth,
      };
      if (init.contentType) headers["content-type"] = init.contentType;
      if (init.depth) headers.depth = init.depth;
      const res = await fetchImpl(current, {
        method,
        headers,
        body: init.body,
        redirect: "manual",
      });
      if (res.status < 300 || res.status >= 400) return res;
      const location = res.headers.get("location");
      if (!location) {
        throw new CaldavError(
          "caldav_redirect_failed",
          `CalDAV redirect missing Location (${res.status})`,
        );
      }
      current = new URL(location, current).toString();
      // Only GET-style methods are typically redirected with body dropped; CalDAV
      // PUT/DELETE/PROPFIND must re-issue the same method after each hop.
    }
    throw new CaldavError(
      "caldav_redirect_failed",
      "CalDAV redirect limit exceeded",
    );
  }

  return {
    async putEvent(event) {
      const ics = buildVeventIcs(event);
      const url = eventObjectUrl(options.caldavUrl, event.uid);
      const res = await request("PUT", url, {
        body: ics,
        contentType: "text/calendar; charset=utf-8",
      });
      if (!res.ok && res.status !== 201 && res.status !== 204) {
        throw new CaldavError(
          "caldav_put_failed",
          `CalDAV PUT failed (${res.status})`,
        );
      }
      return { id: event.uid };
    },
    async deleteEvent(eventId) {
      const url = eventObjectUrl(options.caldavUrl, eventId);
      const res = await request("DELETE", url);
      if (!res.ok && res.status !== 204 && res.status !== 404) {
        throw new CaldavError(
          "caldav_delete_failed",
          `CalDAV DELETE failed (${res.status})`,
        );
      }
    },
    async propfind() {
      const res = await request("PROPFIND", collectionUrl, {
        body:
          '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>',
        contentType: "application/xml; charset=utf-8",
        depth: "0",
      });
      if (!res.ok && res.status !== 207) {
        throw new CaldavError(
          "caldav_propfind_failed",
          `CalDAV PROPFIND failed (${res.status})`,
        );
      }
    },
  };
}

/** Build a client: synthetic host or stub env → stub; else live. */
export async function createCaldavClient(input: {
  caldavUrl: string;
  username: string;
  password: string;
  meetingIdForStub?: string;
  forceStub?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<CaldavClient> {
  const host = hostnameFromCaldavUrl(input.caldavUrl);
  if (
    input.forceStub ||
    isCaldavSyncStubMode() ||
    isSyntheticCaldavHost(host)
  ) {
    return createStubCaldavClient(input.meetingIdForStub);
  }
  return await createLiveCaldavClient({
    caldavUrl: input.caldavUrl,
    username: input.username,
    password: input.password,
    fetchImpl: input.fetchImpl,
  });
}

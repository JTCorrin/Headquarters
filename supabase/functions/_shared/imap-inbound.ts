/**
 * Bounded IMAP inbound fetch for mailbox sync.
 * Supports tls / starttls / none. Body truncated to maxBodyBytes; attachments not fetched.
 * Connect / command / overall deadlines map to error code `timeout` (not imap_connection_failed).
 */

export type ImapSecurity = "tls" | "starttls" | "none";

/** Defaults — Edge sync/probe should finish or fail honestly before platform kill. */
export const IMAP_CONNECT_TIMEOUT_MS = 10_000;
export const IMAP_COMMAND_TIMEOUT_MS = 30_000;
export const IMAP_PROBE_TIMEOUT_MS = 15_000;
export const IMAP_SYNC_OVERALL_TIMEOUT_MS = 90_000;

export type ImapTimeoutOptions = {
  connectTimeoutMs?: number;
  commandTimeoutMs?: number;
  overallTimeoutMs?: number;
};

export type ImapFetchOptions = {
  host: string;
  port: number;
  security: ImapSecurity;
  username: string;
  password: string;
  lookbackDays: number;
  maxMessages: number;
  maxBodyBytes: number;
} & ImapTimeoutOptions;

export type ImapProbeOptions = {
  host: string;
  port: number;
  security: ImapSecurity;
  username: string;
  password: string;
} & ImapTimeoutOptions;

export type InboundImapMessage = {
  provider_message_id: string;
  provider_thread_id: string | null;
  from_address: string;
  from_name: string | null;
  to_addresses: Array<{ email: string; name: string | null }>;
  subject: string;
  body_text: string;
  preview_text: string;
  received_at: string;
  body_truncated: boolean;
};

export class ImapSyncError extends Error {
  readonly code: string;
  readonly authFailed: boolean;
  /** Sync pipeline step hint for API clients (connect/login/select/search/fetch/…). */
  readonly step: string | null;

  constructor(
    code: string,
    message: string,
    authFailed = false,
    step: string | null = null,
  ) {
    super(message);
    this.name = "ImapSyncError";
    this.code = code;
    this.authFailed = authFailed;
    this.step = step;
  }
}

/**
 * Max UIDs per UID FETCH command (keeps each command under the command deadline).
 * Held at 1 until Mailcow/Dovecot FETCH literal framing is proven stable in staging.
 */
export const IMAP_FETCH_BATCH_SIZE = 1;

/** Split UIDs into batches of 1–5 (default {@link IMAP_FETCH_BATCH_SIZE}). */
export function chunkUids(
  uids: number[],
  batchSize = IMAP_FETCH_BATCH_SIZE,
): number[][] {
  const size = Math.max(1, Math.min(5, Math.floor(batchSize)));
  const batches: number[][] = [];
  for (let i = 0; i < uids.length; i += size) {
    batches.push(uids.slice(i, i + size));
  }
  return batches;
}

export function isSyntheticImapHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "imap.example.test" || h.endsWith(".example.test");
}

/** DNS resolver seam for SSRF host checks (inject in tests). */
export type OutboundDnsResolveFn = (
  hostname: string,
  recordType: "A" | "AAAA",
) => Promise<string[]>;

const BLOCKED_OUTBOUND_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata",
  "host.docker.internal",
  "kubernetes.default",
  "kubernetes.default.svc",
  "kubernetes.default.svc.cluster.local",
]);

function normalizeHostname(host: string): string {
  return host.trim().toLowerCase().replace(/\.+$/, "");
}

function stripIpBrackets(ip: string): string {
  const t = ip.trim().toLowerCase();
  if (t.startsWith("[") && t.endsWith("]")) return t.slice(1, -1);
  return t;
}

function parseIpv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    octets.push(n);
  }
  return octets;
}

function ipv4ToInt(octets: number[]): number {
  return ((octets[0]! << 24) >>> 0) + (octets[1]! << 16) + (octets[2]! << 8) +
    octets[3]!;
}

function inIpv4Cidr(octets: number[], base: number[], prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToInt(octets) & mask) === (ipv4ToInt(base) & mask);
}

/** True for private, loopback, link-local, CGNAT, and cloud metadata ranges. */
export function isBlockedOutboundIp(ip: string): boolean {
  const raw = stripIpBrackets(ip);
  if (!raw) return true;

  const v4 = parseIpv4(raw);
  if (v4) {
    return (
      inIpv4Cidr(v4, [0, 0, 0, 0], 8) || // "this" network
      inIpv4Cidr(v4, [10, 0, 0, 0], 8) ||
      inIpv4Cidr(v4, [127, 0, 0, 0], 8) ||
      inIpv4Cidr(v4, [169, 254, 0, 0], 16) || // link-local + metadata
      inIpv4Cidr(v4, [172, 16, 0, 0], 12) ||
      inIpv4Cidr(v4, [192, 168, 0, 0], 16) ||
      inIpv4Cidr(v4, [100, 64, 0, 0], 10) // CGNAT
    );
  }

  // IPv4-mapped IPv6 (::ffff:a.b.c.d)
  const mapped = raw.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped?.[1]) return isBlockedOutboundIp(mapped[1]);

  // Compressed / expanded IPv6 — normalize via URL parser when available.
  let v6 = raw;
  if (!v6.includes(":")) return false;
  try {
    // Deno may keep brackets on IPv6 hostnames from URL().
    const parsed = new URL(`http://[${stripIpBrackets(v6)}]/`);
    v6 = stripIpBrackets(parsed.hostname);
  } catch {
    // Keep raw; still apply prefix checks below on common forms.
  }

  if (v6 === "::1" || v6 === "0:0:0:0:0:0:0:1") return true;
  if (v6 === "::" || v6 === "0:0:0:0:0:0:0:0") return true;

  // Unique local fc00::/7, link-local fe80::/10
  const head = v6.split(":")[0] ?? "";
  if (/^f[cd]/i.test(head)) return true;
  if (/^fe[89ab]/i.test(head)) return true;

  return false;
}

/** True for localhost / internal / metadata-style hostnames (not public DNS names). */
export function isBlockedOutboundHostname(host: string): boolean {
  const h = normalizeHostname(host);
  if (!h) return true;
  if (BLOCKED_OUTBOUND_HOSTNAMES.has(h)) return true;
  if (
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.endsWith(".lan") ||
    h.endsWith(".home") ||
    h.endsWith(".corp")
  ) {
    return true;
  }
  if (h === "::1" || h === "[::1]") return true;
  if (parseIpv4(h) || h.includes(":")) return isBlockedOutboundIp(h);
  return false;
}

async function defaultResolveDns(
  hostname: string,
  recordType: "A" | "AAAA",
): Promise<string[]> {
  try {
    return await Deno.resolveDns(hostname, recordType);
  } catch {
    return [];
  }
}

/** Result of an outbound SSRF check: connect to `connectHost`, TLS-verify as `hostname`. */
export type SafeOutboundTarget = {
  /** Original hostname (or literal) for TLS SNI / certificate verification. */
  hostname: string;
  /** Address used for TCP connect — pinned public IP when DNS was used. */
  connectHost: string;
};

function formatConnectHost(ip: string): string {
  const raw = stripIpBrackets(ip);
  return raw.includes(":") ? `[${raw}]` : raw;
}

/**
 * Resolve host and reject private/link-local/metadata targets before TCP connect.
 * Returns a DNS-pinned connect address so later TCP/TLS cannot rebind to a private IP.
 * Synthetic `*.example.test` hosts are allowed (mailbox test short-circuit / unit doubles).
 */
export async function assertSafeOutboundHost(
  host: string,
  resolveDns: OutboundDnsResolveFn = defaultResolveDns,
): Promise<SafeOutboundTarget> {
  const h = host.trim();
  if (!h) {
    throw new ImapSyncError(
      "imap_host_blocked",
      "Mailbox host is empty",
      false,
      "connect",
    );
  }

  if (isSyntheticImapHost(h)) {
    return { hostname: h, connectHost: h };
  }

  if (isBlockedOutboundHostname(h)) {
    throw new ImapSyncError(
      "imap_host_blocked",
      "Mailbox host is not allowed (private or internal name)",
      false,
      "connect",
    );
  }

  // Literal IP — no DNS needed.
  const literal = stripIpBrackets(h);
  if (parseIpv4(literal) || literal.includes(":")) {
    if (isBlockedOutboundIp(literal)) {
      throw new ImapSyncError(
        "imap_host_blocked",
        "Mailbox host address is not allowed",
        false,
        "connect",
      );
    }
    return { hostname: h, connectHost: formatConnectHost(literal) };
  }

  const normalized = normalizeHostname(h);
  const [aRecords, aaaaRecords] = await Promise.all([
    resolveDns(normalized, "A"),
    resolveDns(normalized, "AAAA"),
  ]);
  const addrs = [...aRecords, ...aaaaRecords];
  if (addrs.length === 0) {
    throw new ImapSyncError(
      "imap_connection_failed",
      "Mailbox host could not be resolved",
      false,
      "connect",
    );
  }
  for (const addr of addrs) {
    if (isBlockedOutboundIp(addr)) {
      throw new ImapSyncError(
        "imap_host_blocked",
        "Mailbox host resolves to a blocked address",
        false,
        "connect",
      );
    }
  }

  // Prefer first A, then AAAA — pin that address for the TCP connect.
  const pinned = aRecords[0] ?? aaaaRecords[0]!;
  return { hostname: normalized, connectHost: formatConnectHost(pinned) };
}

function timeoutStepFromLabel(label: string): string | null {
  const lower = label.toLowerCase();
  if (lower.includes("fetch")) return "fetch";
  if (lower.includes("search")) return "search";
  if (lower.includes("select")) return "select";
  if (lower.includes("login") || lower.includes("probe")) return "login";
  if (
    lower.includes("connect") || lower.includes("greeting") ||
    lower.includes("starttls")
  ) {
    return "connect";
  }
  if (lower.includes("sync")) return "sync";
  return null;
}

/** Race a promise against a deadline; maps expiry / AbortError → `timeout`. */
export async function withImapTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  step: string | null = timeoutStepFromLabel(label),
): Promise<T> {
  const budget = Math.max(1, Math.floor(ms));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new ImapSyncError(
              "timeout",
              `${label} timed out after ${budget}ms`,
              false,
              step,
            ),
          );
        }, budget);
      }),
    ]);
  } catch (error) {
    if (error instanceof ImapSyncError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ImapSyncError(
        "timeout",
        `${label} timed out after ${budget}ms`,
        false,
        step,
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/timed?\s*out|aborted|abort/i.test(message)) {
      throw new ImapSyncError(
        "timeout",
        `${label} timed out after ${budget}ms`,
        false,
        step,
      );
    }
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Short safe copy for Sync API clients (no host/password/body). */
export function safeMailboxSyncFailureMessage(
  code: string,
  step: string | null = null,
): { message: string; step: string | null } {
  const resolvedStep = step ??
    ({
      imap_auth_failed: "login",
      imap_select_failed: "select",
      imap_search_failed: "search",
      imap_fetch_failed: "fetch",
      imap_tls_failed: "connect",
      imap_connection_failed: "connect",
      imap_host_blocked: "connect",
      credentials_missing: "credentials",
      lease_error: "lease",
      not_claimed: "lease",
      timeout: null,
      sync_failed: "sync",
    }[code] ?? null);

  const byCode: Record<string, string> = {
    timeout: resolvedStep
      ? `Mailbox sync timed out during ${resolvedStep}. Try Sync again, or reduce inbox load.`
      : "Mailbox sync timed out. Try Sync again, or reduce inbox load.",
    imap_auth_failed:
      "IMAP sign-in failed — check email and password (or app password).",
    imap_select_failed: "Could not open the inbox (SELECT failed).",
    imap_search_failed: "Could not search the inbox for recent messages.",
    imap_fetch_failed:
      "Could not download message contents from the mail server.",
    imap_tls_failed:
      "Secure connection failed — try a different security setting (SSL / STARTTLS).",
    imap_connection_failed:
      "Could not reach the mail server — check host, port, and security settings.",
    imap_host_blocked:
      "This mail host is not allowed — private, link-local, and metadata addresses are blocked.",
    credentials_missing:
      "Mailbox credentials are missing — save a password, then try Sync again.",
    lease_error: "Could not start sync — try again in a moment.",
    not_claimed:
      "Another sync is already running — wait a moment and try again.",
    sync_failed: "Mailbox sync failed — try again or check mailbox settings.",
  };

  return {
    message: byCode[code] ?? `Mailbox sync failed (${code}).`,
    step: resolvedStep,
  };
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** IMAP SEARCH SINCE date: `01-Jan-2026` (UTC calendar day). */
export function formatImapSinceDate(
  lookbackDays: number,
  now = new Date(),
): string {
  const d = new Date(now.getTime() - Math.max(lookbackDays, 0) * 86_400_000);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = MONTHS[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  return `${day}-${month}-${year}`;
}

export function parseAddressList(headerValue: string | undefined): Array<{
  email: string;
  name: string | null;
}> {
  if (!headerValue?.trim()) return [];
  const results: Array<{ email: string; name: string | null }> = [];
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of headerValue) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === "," && !inQuotes) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);

  for (const part of parts) {
    const angle = part.match(/^(.*?)<([^>]+)>\s*$/);
    if (angle) {
      const email = angle[2].trim().toLowerCase();
      const rawName = angle[1].trim().replace(/^"|"$/g, "");
      if (email.includes("@")) results.push({ email, name: rawName || null });
      continue;
    }
    const email = part.trim().replace(/^<|>$/g, "").toLowerCase();
    if (email.includes("@")) results.push({ email, name: null });
  }
  return results;
}

export function parseHeaderBlock(raw: string): Record<string, string> {
  const unfolded = raw.replace(/\r?\n[ \t]+/g, " ");
  const headers: Record<string, string> = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (!key) continue;
    if (headers[key]) headers[key] += `, ${value}`;
    else headers[key] = value;
  }
  return headers;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeCharset(charset: string): string {
  const c = charset.trim().toLowerCase().replace(/_/g, "-");
  if (c === "utf8") return "utf-8";
  if (c === "us-ascii" || c === "ascii") return "utf-8";
  if (c === "latin1" || c === "latin-1" || c === "iso-8859-1") {
    return "iso-8859-1";
  }
  return c || "utf-8";
}

function bytesToText(bytes: Uint8Array, charset: string): string {
  const label = normalizeCharset(charset);
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** Decode quoted-printable body octets (soft line breaks + =XX). */
export function decodeQuotedPrintable(raw: string): Uint8Array {
  const stripped = raw.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === "=" && i + 2 < stripped.length) {
      const hex = stripped.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        out.push(Number.parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    out.push(stripped.charCodeAt(i) & 0xff);
  }
  return Uint8Array.from(out);
}

/** Decode base64 body (whitespace ignored). */
export function decodeBase64Body(raw: string): Uint8Array {
  const cleaned = raw.replace(/\s+/g, "");
  if (!cleaned) return new Uint8Array();
  const binary = atob(cleaned);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function decodeTransferEncoding(
  raw: string,
  cte: string | undefined,
  charset: string,
): string {
  const enc = (cte ?? "7bit").trim().toLowerCase();
  if (enc === "quoted-printable") {
    return bytesToText(decodeQuotedPrintable(raw), charset);
  }
  if (enc === "base64") {
    return bytesToText(decodeBase64Body(raw), charset);
  }
  return raw;
}

function charsetFromContentType(contentType: string | undefined): string {
  const m = contentType?.match(/charset\s*=\s*"?([^";\s]+)"?/i);
  return m?.[1] ?? "utf-8";
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function looksLikeMultipartBody(body: string): boolean {
  const trimmed = body.replace(/^\uFEFF/, "").replace(/^\r?\n+/, "");
  if (!trimmed.startsWith("--")) return false;
  return /^--\S[\s\S]*?\nContent-Type\s*:/i.test(trimmed);
}

function decodeMultipartAlternative(body: string): string | null {
  const trimmed = body.replace(/^\uFEFF/, "").replace(/^\r?\n+/, "");
  const first = trimmed.match(/^--([^\r\n]+)/);
  if (!first) return null;
  let boundary = first[1];
  if (boundary.endsWith("--")) boundary = boundary.slice(0, -2);
  if (!boundary) return null;

  const delim = new RegExp(
    `(?:^|\r?\n)--${escapeRegExp(boundary)}(?:--)?(?=\r?\n|$)`,
  );
  const segments = trimmed.split(delim);
  let plain: string | null = null;
  let html: string | null = null;

  for (const segment of segments) {
    if (!segment || !/\S/.test(segment)) continue;
    const headerEnd = segment.search(/\r?\n\r?\n/);
    if (headerEnd < 0) continue;
    const headers = parseHeaderBlock(segment.slice(0, headerEnd));
    const contentType = headers["content-type"] ?? "";
    const ctLower = contentType.toLowerCase();
    if (!ctLower.includes("text/plain") && !ctLower.includes("text/html")) {
      continue;
    }

    const partRaw = segment.slice(headerEnd).replace(/^\r?\n\r?\n/, "");
    const decoded = decodeTransferEncoding(
      partRaw,
      headers["content-transfer-encoding"],
      charsetFromContentType(contentType),
    ).replace(/\s+$/u, "");

    if (ctLower.includes("text/plain") && plain === null) plain = decoded;
    else if (ctLower.includes("text/html") && html === null) html = decoded;
  }

  if (plain !== null && plain.length > 0) return plain;
  if (html !== null) return stripHtmlToText(html);
  return null;
}

/**
 * Turn IMAP BODY[TEXT] into displayable plain text.
 * Prefers multipart text/plain; decodes quoted-printable / base64; HTML→text fallback.
 */
export function decodeMimeBodyText(raw: string): string {
  if (!raw) return "";
  if (looksLikeMultipartBody(raw)) {
    const decoded = decodeMultipartAlternative(raw);
    if (decoded !== null) return decoded;
  }
  return raw;
}

function quoteImapString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export type ImapByteConn = {
  read(p: Uint8Array): Promise<number | null>;
  write(p: Uint8Array): Promise<number>;
  close(): void;
};

type ByteConn = ImapByteConn;

/**
 * Test helper: run one IMAP command against a scripted byte stream.
 * Caller supplies the server response (no greeting); first tag is A0001.
 */
export async function runImapCommandForTests(
  conn: ImapByteConn,
  payload: string,
  label = "IMAP FETCH",
  commandTimeoutMs = 5_000,
): Promise<{ status: string; text: string; untagged: string[] }> {
  const session = new ImapSession(conn, commandTimeoutMs);
  try {
    return await session.command(payload, label);
  } finally {
    session.close();
  }
}

class ImapSession {
  private conn: ByteConn;
  private buffer = new Uint8Array(0);
  private tagSeq = 0;
  private readonly decoder = new TextDecoder();
  private readonly encoder = new TextEncoder();
  private readonly commandTimeoutMs: number;

  constructor(conn: ByteConn, commandTimeoutMs = IMAP_COMMAND_TIMEOUT_MS) {
    this.conn = conn;
    this.commandTimeoutMs = commandTimeoutMs;
  }

  close() {
    try {
      this.conn.close();
    } catch {
      /* ignore */
    }
  }

  private async fill(minBytes: number): Promise<void> {
    while (this.buffer.length < minBytes) {
      const chunk = new Uint8Array(8192);
      const n = await this.conn.read(chunk);
      if (n === null) {
        throw new ImapSyncError(
          "imap_connection_failed",
          "IMAP connection closed",
        );
      }
      const next = new Uint8Array(this.buffer.length + n);
      next.set(this.buffer);
      next.set(chunk.subarray(0, n), this.buffer.length);
      this.buffer = next;
    }
  }

  private async readLineBytes(): Promise<Uint8Array> {
    while (true) {
      for (let i = 0; i < this.buffer.length - 1; i++) {
        if (this.buffer[i] === 0x0d && this.buffer[i + 1] === 0x0a) {
          const line = this.buffer.subarray(0, i);
          this.buffer = this.buffer.subarray(i + 2);
          return line;
        }
      }
      await this.fill(this.buffer.length + 1);
    }
  }

  private async readExact(n: number): Promise<Uint8Array> {
    await this.fill(n);
    const out = this.buffer.subarray(0, n);
    this.buffer = this.buffer.subarray(n);
    return out;
  }

  async readGreeting(): Promise<void> {
    const line = this.decoder.decode(await this.readLineBytes());
    if (!/^\* (OK|PREAUTH)/i.test(line)) {
      throw new ImapSyncError(
        "imap_connection_failed",
        `Unexpected IMAP greeting: ${line}`,
      );
    }
  }

  async command(
    payload: string,
    label = "IMAP command",
  ): Promise<{ status: string; text: string; untagged: string[] }> {
    return await withImapTimeout(
      this.commandInner(payload),
      this.commandTimeoutMs,
      label,
    );
  }

  private async commandInner(
    payload: string,
  ): Promise<{ status: string; text: string; untagged: string[] }> {
    const tag = `A${String(++this.tagSeq).padStart(4, "0")}`;
    await this.conn.write(this.encoder.encode(`${tag} ${payload}\r\n`));

    const untagged: string[] = [];
    while (true) {
      let line = this.decoder.decode(await this.readLineBytes());

      const literalMatch = line.match(/\{(\d+)\}$/);
      if (literalMatch) {
        const size = Number(literalMatch[1]);
        // RFC 3501: `{n} CRLF` then exactly n octets; response continues immediately
        // (often `)` or the next BODY token). Do NOT consume a phantom post-literal CRLF.
        const literal = await this.readExact(size);
        line = `${line}\n${this.decoder.decode(literal)}`;
        untagged.push(line);
        continue;
      }

      if (line.startsWith("* ") || line.startsWith("+ ")) {
        untagged.push(line);
        continue;
      }

      if (line.startsWith(`${tag} `)) {
        const rest = line.slice(tag.length + 1);
        const status = rest.split(/\s+/, 1)[0]?.toUpperCase() ?? "BAD";
        return { status, text: rest, untagged };
      }

      untagged.push(line);
    }
  }
}

/** Minimal session surface for probe/sync + test doubles. */
export type ImapSessionLike = {
  command(
    payload: string,
    label?: string,
  ): Promise<{ status: string; text: string; untagged: string[] }>;
  readGreeting(): Promise<void>;
  close(): void;
};

export type OpenImapFn = (
  host: string,
  port: number,
  security: ImapSecurity,
  connectTimeoutMs: number,
  commandTimeoutMs: number,
) => Promise<ImapSessionLike>;

async function openImapConnection(
  host: string,
  port: number,
  security: ImapSecurity,
  connectTimeoutMs = IMAP_CONNECT_TIMEOUT_MS,
  commandTimeoutMs = IMAP_COMMAND_TIMEOUT_MS,
): Promise<ImapSessionLike> {
  const deadline = Date.now() + Math.max(1, connectTimeoutMs);
  const remaining = () => Math.max(1, deadline - Date.now());

  // Reject private/link-local/metadata targets and pin the resolved address.
  const target = await assertSafeOutboundHost(host);

  try {
    // Always TCP-connect to the pinned address, then startTls with the original
    // hostname so SNI/cert verification stay correct (closes DNS rebinding).
    const plain = await withImapTimeout(
      Deno.connect({ hostname: target.connectHost, port }),
      remaining(),
      "IMAP connect",
    );

    if (security === "tls") {
      const conn = await withImapTimeout(
        Deno.startTls(plain, { hostname: target.hostname }),
        remaining(),
        "IMAP TLS handshake",
      );
      const session = new ImapSession(conn, commandTimeoutMs);
      await withImapTimeout(
        session.readGreeting(),
        remaining(),
        "IMAP greeting",
      );
      return session;
    }

    const session = new ImapSession(plain, commandTimeoutMs);
    await withImapTimeout(session.readGreeting(), remaining(), "IMAP greeting");

    if (security === "none") return session;

    const started = await session.command("STARTTLS");
    if (started.status !== "OK") {
      session.close();
      throw new ImapSyncError(
        "imap_tls_failed",
        `STARTTLS failed: ${started.text}`,
      );
    }

    // Upgrade the same TCP connection. Do not close `session` first (would close plain).
    const tlsConn = await withImapTimeout(
      Deno.startTls(plain, { hostname: target.hostname }),
      remaining(),
      "IMAP STARTTLS upgrade",
    );
    return new ImapSession(tlsConn, commandTimeoutMs);
  } catch (error) {
    if (error instanceof ImapSyncError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ImapSyncError("timeout", "IMAP connect timed out");
    }
    const message = error instanceof Error
      ? error.message
      : "connection failed";
    if (/timed?\s*out|aborted|abort/i.test(message)) {
      throw new ImapSyncError("timeout", message);
    }
    const code = /tls|certificate|ssl/i.test(message)
      ? "imap_tls_failed"
      : "imap_connection_failed";
    throw new ImapSyncError(code, message);
  }
}

let openImapConnectionImpl: OpenImapFn = openImapConnection;

/** Test seam — pass null to restore the real opener. */
export function setOpenImapConnectionForTests(fn: OpenImapFn | null): void {
  openImapConnectionImpl = fn ?? openImapConnection;
}

function extractUidList(untagged: string[]): number[] {
  const uids: number[] = [];
  for (const line of untagged) {
    const m = line.match(/^\* SEARCH(?:\s+(.+))?$/i);
    if (!m?.[1]?.trim()) continue;
    for (const tok of m[1].trim().split(/\s+/)) {
      const n = Number(tok);
      if (Number.isFinite(n) && n > 0) uids.push(n);
    }
  }
  return uids;
}

/** Extract literal body after `BODY[...] {n}\\n`. */
export function extractBodyLiteral(
  block: string,
  sectionPrefix: string,
): string | null {
  const idx = block.toUpperCase().indexOf(
    `BODY[${sectionPrefix.toUpperCase()}`,
  );
  if (idx < 0) return null;
  const from = block.slice(idx);
  const lit = from.match(/^BODY\[[^\]]*\](?:<[^>]+>)?\s*\{(\d+)\}\n/i);
  if (!lit || lit.index === undefined) return null;
  const size = Number(lit[1]);
  const start = lit.index + lit[0].length;
  return from.slice(start, start + size);
}

function extractUid(block: string): number | null {
  const m = block.match(/\bUID (\d+)\b/i);
  return m ? Number(m[1]) : null;
}

function extractInternalDate(block: string): string | null {
  const m = block.match(/INTERNALDATE "([^"]+)"/i);
  return m?.[1] ?? null;
}

function parseInternalDate(raw: string | null): string {
  if (!raw) return new Date().toISOString();
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

function splitFetchBlocks(untagged: string[]): string[] {
  const combined = untagged.join("\n");
  const parts = combined.split(/(?=^\* \d+ FETCH )/m).filter((p) =>
    /^\* \d+ FETCH /i.test(p)
  );
  return parts;
}

/**
 * Live IMAP probe: connect + LOGIN + LOGOUT.
 * Throws ImapSyncError (`timeout` / `imap_auth_failed` / `imap_connection_failed` / `imap_tls_failed`).
 */
export async function probeImap(options: ImapProbeOptions): Promise<void> {
  const connectTimeoutMs = options.connectTimeoutMs ?? IMAP_CONNECT_TIMEOUT_MS;
  const commandTimeoutMs = options.commandTimeoutMs ?? IMAP_COMMAND_TIMEOUT_MS;
  const overallTimeoutMs = options.overallTimeoutMs ?? IMAP_PROBE_TIMEOUT_MS;

  await withImapTimeout(
    (async () => {
      const session = await openImapConnectionImpl(
        options.host,
        options.port,
        options.security,
        connectTimeoutMs,
        commandTimeoutMs,
      );
      try {
        const login = await session.command(
          `LOGIN ${quoteImapString(options.username)} ${
            quoteImapString(options.password)
          }`,
        );
        if (login.status !== "OK") {
          throw new ImapSyncError(
            "imap_auth_failed",
            `IMAP LOGIN failed: ${login.text}`,
            true,
          );
        }
        await session.command("LOGOUT").catch(() => undefined);
      } finally {
        session.close();
      }
    })(),
    overallTimeoutMs,
    "IMAP probe",
  );
}

export async function fetchInboundFromImap(
  options: ImapFetchOptions,
): Promise<InboundImapMessage[]> {
  const connectTimeoutMs = options.connectTimeoutMs ?? IMAP_CONNECT_TIMEOUT_MS;
  const commandTimeoutMs = options.commandTimeoutMs ?? IMAP_COMMAND_TIMEOUT_MS;
  const overallTimeoutMs = options.overallTimeoutMs ??
    IMAP_SYNC_OVERALL_TIMEOUT_MS;

  return await withImapTimeout(
    fetchInboundFromImapInner(options, connectTimeoutMs, commandTimeoutMs),
    overallTimeoutMs,
    "IMAP sync",
  );
}

function parseFetchBlockToMessage(
  block: string,
  maxBodyBytes: number,
): InboundImapMessage | null {
  const uid = extractUid(block);
  if (!uid) return null;
  const headerRaw = extractBodyLiteral(block, "HEADER.FIELDS") ?? "";
  const bodyRaw = extractBodyLiteral(block, "TEXT") ?? "";
  const headers = parseHeaderBlock(headerRaw);
  const from = parseAddressList(headers["from"])[0] ?? {
    email: "unknown@invalid",
    name: null,
  };
  const to = parseAddressList(headers["to"]);
  const messageId = headers["message-id"]?.trim();
  const inReplyTo = headers["in-reply-to"]?.trim();
  const references =
    headers["references"]?.trim()?.split(/\s+/).filter(Boolean) ?? [];
  const providerMessageId =
    (messageId && messageId.length > 0 ? messageId : `imap-uid-${uid}`)
      .slice(0, 500);
  const providerThreadId = (inReplyTo || references[0] || providerMessageId)
    .slice(0, 500);
  const truncated =
    new TextEncoder().encode(bodyRaw).byteLength >= maxBodyBytes;
  const bodyText = decodeMimeBodyText(bodyRaw).slice(0, maxBodyBytes);
  return {
    provider_message_id: providerMessageId,
    provider_thread_id: providerThreadId,
    from_address: from.email,
    from_name: from.name,
    to_addresses: to,
    subject: (headers["subject"] ?? "").slice(0, 998),
    body_text: bodyText,
    preview_text: bodyText.replace(/\s+/g, " ").trim().slice(0, 160),
    received_at: parseInternalDate(extractInternalDate(block)),
    body_truncated: truncated,
  };
}

async function fetchInboundFromImapInner(
  options: ImapFetchOptions,
  connectTimeoutMs: number,
  commandTimeoutMs: number,
): Promise<InboundImapMessage[]> {
  const session = await openImapConnectionImpl(
    options.host,
    options.port,
    options.security,
    connectTimeoutMs,
    commandTimeoutMs,
  );
  try {
    const login = await session.command(
      `LOGIN ${quoteImapString(options.username)} ${
        quoteImapString(options.password)
      }`,
    );
    if (login.status !== "OK") {
      throw new ImapSyncError(
        "imap_auth_failed",
        `IMAP LOGIN failed: ${login.text}`,
        true,
        "login",
      );
    }

    const selected = await session.command("SELECT INBOX", "IMAP SELECT");
    if (selected.status !== "OK") {
      throw new ImapSyncError(
        "imap_select_failed",
        `SELECT INBOX failed: ${selected.text}`,
        false,
        "select",
      );
    }

    const since = formatImapSinceDate(options.lookbackDays);
    const search = await session.command(
      `UID SEARCH SINCE ${since}`,
      "IMAP SEARCH",
    );
    if (search.status !== "OK") {
      throw new ImapSyncError(
        "imap_search_failed",
        `UID SEARCH failed: ${search.text}`,
        false,
        "search",
      );
    }

    let uids = extractUidList(search.untagged);
    if (uids.length === 0) return [];
    uids = uids.slice(-Math.max(1, options.maxMessages));

    const headerSection =
      "HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES)";
    const fetchSpec =
      `UID INTERNALDATE BODY.PEEK[${headerSection}] BODY.PEEK[TEXT]<0.${
        Math.max(1, options.maxBodyBytes)
      }>`;

    const messages: InboundImapMessage[] = [];
    for (const batch of chunkUids(uids, IMAP_FETCH_BATCH_SIZE)) {
      const fetch = await session.command(
        `UID FETCH ${batch.join(",")} (${fetchSpec})`,
        "IMAP FETCH",
      );
      if (fetch.status !== "OK") {
        throw new ImapSyncError(
          "imap_fetch_failed",
          `UID FETCH failed: ${fetch.text}`,
          false,
          "fetch",
        );
      }
      for (const block of splitFetchBlocks(fetch.untagged)) {
        const message = parseFetchBlockToMessage(block, options.maxBodyBytes);
        if (message) messages.push(message);
      }
    }

    await session.command("LOGOUT").catch(() => undefined);
    return messages;
  } finally {
    session.close();
  }
}

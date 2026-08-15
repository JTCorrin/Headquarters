import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  isOrgApiKeySecret,
  sha256Hex,
  validateApiKeyCreateBody,
} from "./api-keys.ts";
import {
  listMcpTools,
  mcpToolFailureResult,
  parseJsonRpcRequest,
  requireCreateTaskAssignee,
} from "./mcp.ts";
import { validateClientBody } from "./clients.ts";
import {
  decodeCursor,
  extractContactClientId,
  validateContactBody,
} from "./contacts.ts";
import {
  parseDocumentEntityType,
  resolveStoragePublicBase,
  rewriteStorageSignedUrl,
  validateFolderCreateBody,
  validateUploadIntentBody,
} from "./documents.ts";
import {
  ApiError,
  apiPath,
  isStrictIsoTimestamp,
  jsonBody,
  parseLimit,
  parseVersion,
} from "./http.ts";
import {
  sanitizeAiOutput,
  validateDecideBody,
  validateGenerateBody,
  validateInvoiceChaseBody,
} from "./ai-suggestions.ts";
import {
  DEFAULT_AI_PROMPTS,
  mergeEffectivePrompts,
  parseMeetingProposalOutput,
  validateAiPromptsPutBody,
} from "./ai-prompts.ts";
import {
  completeAiPrompt,
  isAiCompletionStubMode,
  listProviderModels,
  shouldStubAiCompletion,
} from "./ai-provider.ts";
import { validateShareBody } from "./email-messages.ts";
import {
  parseAiProvider,
  payloadHasForbiddenSecretKey,
  validateAiConnectBody,
  validateAiModelBody,
} from "./integrations.ts";
import { isMailboxOAuthStubMode } from "../_shared/mailbox-oauth.ts";
import { validateMailboxBody, validateMailboxTestBody } from "./mailbox.ts";
import { resolveLeadCurrency, validateLeadBody } from "./leads.ts";
import { hashIdempotencyRequest, parseIdempotencyKey } from "./idempotency.ts";
import {
  decodeInvoiceCursor,
  invoiceLifecycleIdempotencyPayload,
  validateInvoiceBody,
  validateSendInvoiceBody,
} from "./invoices.ts";
import { billLifecycleIdempotencyPayload, validateBillBody } from "./bills.ts";
import { quoteAcceptIdempotencyPayload } from "./quotes.ts";
import {
  validateVendorBankDetailsBody,
  validateVendorBody,
} from "./vendors.ts";
import { decodeTaskCursor, validateTaskBody } from "./tasks.ts";
import {
  calendarPayloadHasForbiddenSecretKey,
  validateCaldavUpsertBody,
  validateOAuthCallbackParams,
} from "./calendar.ts";
import {
  decodeMeetingCursor,
  parseMeetingListRange,
  validateMeetingBody,
} from "./meetings.ts";
import {
  buildVeventIcs,
  createStubCaldavClient,
  eventObjectUrl,
  hostnameFromCaldavUrl,
  icsEscapeText,
  isCaldavSyncStubMode,
  isSyntheticCaldavHost,
  parseCaldavSecretBlob,
  toIcsUtcDateTime,
} from "../_shared/caldav.ts";
import {
  buildGoogleAuthUrl,
  createStubGoogleCalendarClient,
  isCalendarSyncStubMode,
  parseTokenBlob,
} from "../_shared/google-calendar.ts";
import {
  decodeProjectCursor,
  parseProjectStatusFilter,
  validateProjectBody,
  validateProjectCardBody,
} from "./projects.ts";
import {
  recurringLifecycleIdempotencyPayload,
  validateRecurringScheduleBody,
} from "./recurring-invoices.ts";
import {
  decodePaymentCursor,
  paymentMutationIdempotencyPayload,
  validateAllocateBody,
  validateCreateBody,
  validateReverseBody,
} from "./payments.ts";
import { validateEmailTemplateBody } from "./email-templates.ts";
import {
  handleOrganisationConfiguration,
  validateLogoUploadIntentBody,
  validateOrganisationConfigurationBody,
  validateOrganisationCreateBody,
} from "./organisations.ts";
import {
  decodeProductCategoryCursor,
  validateProductCategoryBody,
} from "./product-categories.ts";
import {
  decodeProductCursor,
  validateAdjustStockBody,
  validateProductBody,
} from "./products.ts";
import { validateProfilePreferencesBody } from "./profile-preferences.ts";
import {
  assertJsonSafeLineMoney,
  decodeQuoteCursor,
  parseQuoteListStatus,
  validateQuoteBody,
} from "./quotes.ts";
import { validateTaxRateBody } from "./tax-rates.ts";
import {
  decodeAuditCursor,
  parseAuditActionFilter,
  parseAuditCategoryFilter,
} from "./audit-events.ts";
import { decodeNotificationCursor } from "./notifications.ts";
import {
  decodeTimelineCursor,
  isOrgTimelineEventsPath,
  parseEntityType,
  validateTimelineNoteBody,
} from "./timeline-events.ts";

Deno.test("apiPath normalises product and native function URLs", () => {
  assertEquals(apiPath("/api/v1/contacts"), "/api/v1/contacts");
  assertEquals(
    apiPath("/functions/v1/api-v1/api/v1/contacts/"),
    "/api/v1/contacts",
  );
  assertEquals(apiPath("/functions/v1/api-v1/contacts/"), "/api/v1/contacts");
  assertEquals(apiPath("/tenant/api/v1/contacts"), "/tenant/api/v1/contacts");
});

Deno.test("parseLimit applies defaults and bounds", () => {
  assertEquals(parseLimit(null), 50);
  assertEquals(parseLimit("200"), 200);
  assertThrows(() => parseLimit("0"), ApiError);
  assertThrows(() => parseLimit("1.5"), ApiError);
  assertThrows(() => parseLimit("201"), ApiError);
});

Deno.test("parseVersion accepts numeric ETags and requires a precondition", () => {
  assertEquals(
    parseVersion(
      new Request("https://example.test", { headers: { "if-match": '"7"' } }),
    ),
    7,
  );
  assertThrows(
    () =>
      parseVersion(
        new Request("https://example.test", {
          headers: { "if-match": 'W/"8"' },
        }),
      ),
    ApiError,
  );
  assertThrows(
    () => parseVersion(new Request("https://example.test")),
    ApiError,
  );
});

Deno.test("jsonBody rejects oversized payloads", async () => {
  await assertRejects(
    () =>
      jsonBody(
        new Request("https://example.test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ value: "x".repeat(65_536) }),
        }),
      ),
    ApiError,
  );
});

Deno.test("jsonBody accepts oversized payloads when maxBytes is raised", async () => {
  const payload = { plain_text: "x".repeat(70_000) };
  const body = await jsonBody(
    new Request("https://example.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
    { maxBytes: 600_000 },
  );
  assertEquals(typeof body.plain_text, "string");
  assertEquals((body.plain_text as string).length, 70_000);
});

Deno.test("contact create validation strips whitespace and supplies lifecycle status", () => {
  assertEquals(
    validateContactBody(
      {
        display_name: "  Ada Lovelace  ",
        primary_email: "ada@example.test",
        metadata: { source_id: "import-1" },
      },
      false,
    ),
    {
      display_name: "Ada Lovelace",
      primary_email: "ada@example.test",
      lifecycle_status: "active",
      metadata: { source_id: "import-1" },
    },
  );
});

Deno.test("contact validation rejects tenancy and invalid lifecycle fields", () => {
  assertThrows(
    () =>
      validateContactBody(
        {
          display_name: "Ada",
          org_id: "52e1a71a-1c93-4ec8-a566-e0eecaf06747",
          lifecycle_status: "lead",
        },
        false,
      ),
    ApiError,
  );
});

Deno.test("contact client_id is a virtual field extracted for client_contacts sync", () => {
  const clientId = "52e1a71a-1c93-4ec8-a566-e0eecaf06747";
  assertEquals(extractContactClientId({ client_id: clientId }), {
    provided: true,
    clientId,
  });
  assertEquals(extractContactClientId({ client_id: null }), {
    provided: true,
    clientId: null,
  });
  assertEquals(extractContactClientId({ display_name: "Ada" }), {
    provided: false,
    clientId: null,
  });
  assertEquals(
    validateContactBody(
      { display_name: "Ada", client_id: clientId },
      false,
    ).display_name,
    "Ada",
  );
  assertEquals(
    validateContactBody({ client_id: clientId }, true),
    {},
  );
});

Deno.test("contact cursors reject untrusted values", () => {
  assertThrows(() => decodeCursor("not-base64"), ApiError);
  assertThrows(
    () =>
      decodeCursor(
        btoa(
          JSON.stringify({
            created_at: "not-a-date",
            id: "52e1a71a-1c93-4ec8-a566-e0eecaf06747",
          }),
        ),
      ),
    ApiError,
  );
});

Deno.test("lead create validation defaults stage and currency", () => {
  assertEquals(
    validateLeadBody(
      {
        name: "  Acme Opportunity  ",
        company_name: "Acme Ltd",
        primary_email: "acme@example.test",
        value_cents: 125000,
      },
      false,
    ),
    {
      name: "Acme Opportunity",
      company_name: "Acme Ltd",
      primary_email: "acme@example.test",
      value_cents: 125000,
      stage: "new",
      currency: "GBP",
      position: 0,
    },
  );
  assertEquals(
    validateLeadBody(
      { name: "USD org lead" },
      false,
      { defaultCurrency: "USD" },
    ).currency,
    "USD",
  );
});

Deno.test("lead validation rejects invalid primary_email", () => {
  assertThrows(
    () =>
      validateLeadBody(
        { name: "Bad email", primary_email: "not-an-email" },
        false,
      ),
    ApiError,
  );
});

Deno.test("lead validation rejects direct won stage and requires lost_reason", () => {
  assertThrows(
    () => validateLeadBody({ name: "Won deal", stage: "won" }, false),
    ApiError,
  );
  assertThrows(
    () => validateLeadBody({ name: "Lost deal", stage: "lost" }, false),
    ApiError,
  );
  assertEquals(
    validateLeadBody(
      { name: "Lost deal", stage: "lost", lost_reason: "No budget" },
      false,
    ).lost_reason,
    "No budget",
  );
});

Deno.test("lead validation rejects unsafe integers and impossible dates", () => {
  assertThrows(
    () =>
      validateLeadBody(
        { name: "Overflow", value_cents: Number.MAX_SAFE_INTEGER + 1 },
        false,
      ),
    ApiError,
  );
  assertThrows(
    () =>
      validateLeadBody(
        { name: "Bad date", expected_close_on: "2026-02-31" },
        false,
      ),
    ApiError,
  );
  assertThrows(
    () =>
      validateLeadBody(
        { name: "Bad probability", probability_percent: 12.345 },
        false,
      ),
    ApiError,
  );
  assertThrows(
    () =>
      validateLeadBody(
        { name: "Position overflow", position: 10_000_000_000 },
        false,
      ),
    ApiError,
  );
  assertEquals(
    validateLeadBody({ name: "Position ok", position: 12345.6789012345 }, false)
      .position,
    12345.6789012345,
  );
});

Deno.test("lead PATCH accepts atomic stage+position and optional client_id", () => {
  const clientId = "52e1a71a-1c93-4ec8-a566-e0eecaf06747";
  assertEquals(
    validateLeadBody({ stage: "proposal", position: 10.5 }, true),
    { stage: "proposal", position: 10.5 },
  );
  assertEquals(
    validateLeadBody({ client_id: clientId }, true),
    { client_id: clientId },
  );
  assertEquals(
    validateLeadBody({ client_id: null }, true),
    { client_id: null },
  );
});

Deno.test("lead currency resolves client default then organisation default", () => {
  assertEquals(
    resolveLeadCurrency({
      clientDefault: "USD",
      orgDefault: "GBP",
    }),
    "USD",
  );
  assertEquals(
    resolveLeadCurrency({
      clientDefault: null,
      orgDefault: "GBP",
    }),
    "GBP",
  );
  assertEquals(
    resolveLeadCurrency({
      explicit: "EUR",
      clientDefault: "USD",
      orgDefault: "GBP",
    }),
    "EUR",
  );
  assertEquals(
    resolveLeadCurrency({
      clientDefault: "usd",
      orgDefault: "GBP",
    }),
    "GBP",
  );
});

Deno.test("client create validation defaults status and rejects conversion fields", () => {
  assertEquals(
    validateClientBody({
      name: "  Acme Ltd  ",
      primary_email: "billing@acme.test",
    }, false),
    {
      name: "Acme Ltd",
      primary_email: "billing@acme.test",
      status: "active",
      tax_exempt: false,
    },
  );
  assertThrows(
    () =>
      validateClientBody(
        {
          name: "Acme Ltd",
          converted_from_lead_id: "52e1a71a-1c93-4ec8-a566-e0eecaf06747",
        },
        false,
      ),
    ApiError,
  );
});

Deno.test("client email_domain rejects public mailbox hosts", () => {
  assertEquals(
    validateClientBody({ name: "Hesis", email_domain: "hesis.co.uk" }, false)
      .email_domain,
    "hesis.co.uk",
  );
  assertThrows(
    () =>
      validateClientBody({ name: "Hesis", email_domain: "gmail.com" }, false),
    ApiError,
  );
});

Deno.test("product category create validation trims name and bounds position", () => {
  assertEquals(
    validateProductCategoryBody(
      { name: "  Widgets  ", description: "Parts" },
      false,
    ),
    {
      name: "Widgets",
      description: "Parts",
      position: 0,
    },
  );
  assertThrows(
    () =>
      validateProductCategoryBody(
        { name: "Bad", position: 10_000_000_000 },
        false,
      ),
    ApiError,
  );
});

Deno.test("product create validation defaults and rejects stock writes / service tracking", () => {
  assertEquals(
    validateProductBody(
      { sku: " SKU-1 ", name: " Widget ", unit_price_cents: 1250 },
      false,
    ),
    {
      sku: "SKU-1",
      name: "Widget",
      product_type: "product",
      unit_price_cents: 1250,
      currency: "GBP",
      track_stock: false,
      status: "active",
    },
  );
  assertEquals(
    validateProductBody(
      { sku: "SKU-USD", name: "Widget", unit_price_cents: 100 },
      false,
      { defaultCurrency: "USD" },
    ).currency,
    "USD",
  );
  assertEquals(
    validateProductBody(
      {
        sku: "SKU-EUR",
        name: "Widget",
        unit_price_cents: 100,
        currency: "EUR",
      },
      false,
      { defaultCurrency: "USD" },
    ).currency,
    "EUR",
  );
  assertThrows(
    () =>
      validateProductBody(
        {
          sku: "S1",
          name: "Svc",
          product_type: "service",
          unit_price_cents: 1,
          track_stock: true,
        },
        false,
      ),
    ApiError,
  );
  assertThrows(
    () =>
      validateProductBody(
        { sku: "S1", name: "Widget", unit_price_cents: 1, stock_qty: 5 },
        false,
      ),
    ApiError,
  );
  assertThrows(
    () =>
      validateProductBody(
        {
          sku: "S1",
          name: "Widget",
          unit_price_cents: Number.MAX_SAFE_INTEGER + 1,
        },
        false,
      ),
    ApiError,
  );
});

Deno.test("stock adjustment validation bounds quantity_delta", () => {
  assertEquals(
    validateAdjustStockBody({ quantity_delta: -3.5, reason: "adjustment" }),
    { quantity_delta: -3.5, reason: "adjustment" },
  );
  assertThrows(() => validateAdjustStockBody({ quantity_delta: 0 }), ApiError);
  assertThrows(
    () => validateAdjustStockBody({ quantity_delta: 10_000_000_000 }),
    ApiError,
  );
  assertThrows(
    () => validateAdjustStockBody({ quantity_delta: 1.00001 }),
    ApiError,
  );
  assertEquals(
    validateAdjustStockBody({
      quantity_delta: 1,
      reason: "adjustment",
      occurred_at: "2026-07-31T12:00:00Z",
    }),
    {
      quantity_delta: 1,
      reason: "adjustment",
      occurred_at: "2026-07-31T12:00:00Z",
    },
  );
  assertThrows(
    () =>
      validateAdjustStockBody({
        quantity_delta: 1,
        occurred_at: "2026-07-31",
      }),
    ApiError,
  );
  assertThrows(
    () =>
      validateAdjustStockBody({
        quantity_delta: 1,
        occurred_at: "2026-02-31T12:00:00Z",
      }),
    ApiError,
  );
});

Deno.test("catalog cursors require strict ISO-8601 timestamps", () => {
  const encode = (createdAt: string) =>
    btoa(JSON.stringify({
      created_at: createdAt,
      id: "52e1a71a-1c93-4ec8-a566-e0eecaf06747",
    }))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");

  assertEquals(
    decodeProductCursor(encode("2026-07-31T12:00:00.123456Z")).created_at,
    "2026-07-31T12:00:00.123456Z",
  );
  assertEquals(
    decodeProductCategoryCursor(encode("2026-07-31T12:00:00+00:00")).created_at,
    "2026-07-31T12:00:00+00:00",
  );
  assertEquals(isStrictIsoTimestamp("2026-02-31T12:00:00Z"), false);
  assertThrows(
    () => decodeProductCursor(encode("2026-02-31T12:00:00Z")),
    ApiError,
  );
  assertThrows(
    () => decodeProductCursor(encode("2026-07-31 12:00:00")),
    ApiError,
  );
  assertThrows(
    () => decodeProductCategoryCursor(encode("July 31, 2026")),
    ApiError,
  );
});

Deno.test("Idempotency-Key parsing and request hashing", async () => {
  assertEquals(
    parseIdempotencyKey(
      new Request("https://example.test", {
        headers: { "idempotency-key": "adj-1" },
      }),
    ),
    "adj-1",
  );
  assertThrows(
    () => parseIdempotencyKey(new Request("https://example.test")),
    ApiError,
  );
  const a = await hashIdempotencyRequest("/api/v1/products/x/adjust-stock", {
    quantity_delta: 1,
  });
  const b = await hashIdempotencyRequest("/api/v1/products/x/adjust-stock", {
    quantity_delta: 2,
  });
  assertEquals(a.length, 64);
  assertEquals(a === b, false);
});

Deno.test("organisation create and configuration validation", () => {
  assertEquals(
    validateOrganisationCreateBody({
      name: "  Corrin Data  ",
      slug: "corrin-data",
      country_code: "gb",
      timezone: "Europe/London",
    }),
    {
      name: "Corrin Data",
      slug: "corrin-data",
      country_code: "GB",
      default_currency: "GBP",
      timezone: "Europe/London",
      locale: "en-GB",
    },
  );
  // V8 supportedValuesOf('timeZone') often omits literal "UTC".
  assertEquals(
    validateOrganisationCreateBody({
      name: "UTC Org",
      slug: "utc-org",
      country_code: "GB",
      timezone: "UTC",
    }).timezone,
    "UTC",
  );
  assertThrows(
    () =>
      validateOrganisationCreateBody({
        name: "Bad",
        slug: "Bad Slug",
        country_code: "GB",
      }),
    ApiError,
  );
  assertThrows(
    () =>
      validateOrganisationCreateBody({
        name: "Bad",
        slug: "ok-slug",
        country_code: "GB",
        timezone: "Not/A_Zone",
      }),
    ApiError,
  );
  assertEquals(
    validateOrganisationConfigurationBody({
      theme_default: "dark",
      default_currency: "USD",
    }),
    { theme_default: "dark", default_currency: "USD" },
  );
  assertEquals(
    validateOrganisationConfigurationBody({
      address_line1: " 12 Harbour Rd ",
      city: "London",
      postal_code: "E1 6AN",
    }),
    {
      address_line1: "12 Harbour Rd",
      city: "London",
      postal_code: "E1 6AN",
    },
  );
  assertThrows(
    () => validateOrganisationConfigurationBody({ theme_default: "neon" }),
    ApiError,
  );
  assertThrows(
    () => validateOrganisationConfigurationBody({ org_id: "x" }),
    ApiError,
  );
  assertEquals(
    validateLogoUploadIntentBody({ mime_type: "image/png", size_bytes: 1024 }),
    { mime_type: "image/png", size_bytes: 1024 },
  );
  assertThrows(
    () =>
      validateLogoUploadIntentBody({
        mime_type: "image/gif",
        size_bytes: 1024,
      }),
    ApiError,
  );
  assertThrows(
    () =>
      validateLogoUploadIntentBody({
        mime_type: "image/png",
        size_bytes: 3_000_000,
      }),
    ApiError,
  );
});

Deno.test("organisation configuration GET is allowed for every membership role", async () => {
  const orgId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const row = {
    id: orgId,
    name: "Corrin Data",
    legal_name: null,
    slug: "corrin-data",
    logo_path: null,
    billing_email: null,
    phone: null,
    website_url: null,
    tax_identifier: null,
    registration_number: null,
    address_line1: null,
    address_line2: null,
    city: null,
    region: null,
    postal_code: null,
    default_currency: "GBP",
    timezone: "UTC",
    locale: "en-GB",
    country_code: "GB",
    theme_default: "system",
    settings: {},
    version: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    deleted_at: null,
  };
  const db = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                is() {
                  return {
                    maybeSingle: () =>
                      Promise.resolve({ data: row, error: null }),
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  for (
    const role of ["owner", "admin", "member", "readonly", "billing"] as const
  ) {
    const response = await handleOrganisationConfiguration(
      new Request("https://example.test/api/v1/organisation/configuration"),
      db as never,
      "/api/v1/organisation/configuration",
      orgId,
      role,
      "req-config-get",
    );
    assertEquals(response.status, 200);
  }
});

Deno.test("organisation configuration PATCH stays owner-only", () => {
  const req = new Request(
    "https://example.test/api/v1/organisation/configuration",
    {
      method: "PATCH",
    },
  );
  for (const role of ["admin", "member", "readonly", "billing"] as const) {
    assertThrows(
      () =>
        handleOrganisationConfiguration(
          req,
          {} as never,
          "/api/v1/organisation/configuration",
          "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          role,
          "req-config-patch",
        ),
      ApiError,
      "Only owners can update organisation configuration",
    );
  }
});

Deno.test("quote create validation defaults currency and rejects calculated fields", () => {
  const productId = "11111111-1111-4111-8111-111111111111";
  const clientId = "22222222-2222-4222-8222-222222222222";
  assertEquals(
    validateQuoteBody(
      {
        title: "  Q2 retainer  ",
        client_id: clientId,
        lines: [
          {
            product_id: productId,
            quantity: 2,
            unit_price_cents: 10000,
            tax_rate_percent: 20,
          },
        ],
      },
      false,
      { defaultCurrency: "USD" },
    ),
    {
      title: "Q2 retainer",
      client_id: clientId,
      currency: "USD",
      lines: [
        {
          product_id: productId,
          quantity: 2,
          unit_price_cents: 10000,
          discount_percent: 0,
          tax_rate_percent: 20,
        },
      ],
    },
  );
  assertThrows(
    () =>
      validateQuoteBody(
        {
          title: "Missing party",
          lines: [],
        },
        false,
      ),
    ApiError,
  );
  assertThrows(
    () =>
      validateQuoteBody(
        {
          title: "Bad",
          client_id: clientId,
          status: "sent",
          lines: [],
        },
        false,
      ),
    ApiError,
  );
  assertThrows(
    () =>
      validateQuoteBody(
        {
          title: "Bad totals",
          client_id: clientId,
          total_cents: 1,
          lines: [],
        },
        false,
      ),
    ApiError,
  );
  assertEquals(
    validateQuoteBody(
      {
        title: "Patch title",
        discount_cents: 100,
      },
      true,
    ),
    { title: "Patch title", discount_cents: 100 },
  );
  assertThrows(() => validateQuoteBody({}, true), ApiError);
  assertThrows(
    () =>
      decodeQuoteCursor(
        btoa(JSON.stringify({ created_at: "not-a-date", id: clientId }))
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replace(/=+$/, ""),
      ),
    ApiError,
  );
});

Deno.test("quote list status filter accepts the full quotes.status enum", () => {
  assertEquals(parseQuoteListStatus(null), null);
  assertEquals(parseQuoteListStatus("draft"), "draft");
  assertEquals(parseQuoteListStatus("sent"), "sent");
  assertEquals(parseQuoteListStatus("accepted"), "accepted");
  assertEquals(parseQuoteListStatus("rejected"), "rejected");
  assertEquals(parseQuoteListStatus("expired"), "expired");
  assertEquals(parseQuoteListStatus("void"), "void");
  assertThrows(() => parseQuoteListStatus("partial"), ApiError);
  assertThrows(() => parseQuoteListStatus("Draft"), ApiError);
  assertThrows(() => parseQuoteListStatus(""), ApiError);
});

Deno.test("quote line money rejects JSON-unsafe quantity × price products", () => {
  const clientId = "22222222-2222-4222-8222-222222222222";
  assertEquals(assertJsonSafeLineMoney(2, 10000), true);
  assertEquals(assertJsonSafeLineMoney(2, Number.MAX_SAFE_INTEGER), false);
  assertEquals(
    assertJsonSafeLineMoney(Number.MAX_SAFE_INTEGER, 1),
    true,
  );
  assertThrows(
    () =>
      validateQuoteBody(
        {
          title: "Overflow",
          client_id: clientId,
          lines: [
            {
              description: "Huge",
              quantity: 2,
              unit_price_cents: Number.MAX_SAFE_INTEGER,
            },
          ],
        },
        false,
      ),
    ApiError,
  );
});

Deno.test("invoice create validation defaults currency, requires client_id, and rejects calculated fields", () => {
  const productId = "11111111-1111-4111-8111-111111111111";
  const clientId = "22222222-2222-4222-8222-222222222222";
  assertEquals(
    validateInvoiceBody(
      {
        client_id: clientId,
        due_on: "2026-09-01",
        purchase_order_number: "  PO-42  ",
        lines: [
          {
            product_id: productId,
            quantity: 2,
            unit_price_cents: 10000,
            tax_rate_percent: 20,
          },
        ],
      },
      false,
      { defaultCurrency: "USD" },
    ),
    {
      client_id: clientId,
      currency: "USD",
      due_on: "2026-09-01",
      purchase_order_number: "PO-42",
      lines: [
        {
          product_id: productId,
          quantity: 2,
          unit_price_cents: 10000,
          discount_percent: 0,
          tax_rate_percent: 20,
        },
      ],
    },
  );
  assertThrows(
    () =>
      validateInvoiceBody(
        {
          lines: [],
        },
        false,
      ),
    ApiError,
  );
  assertThrows(
    () =>
      validateInvoiceBody(
        {
          client_id: clientId,
          status: "sent",
          lines: [],
        },
        false,
      ),
    ApiError,
  );
  assertThrows(
    () =>
      validateInvoiceBody(
        {
          client_id: clientId,
          total_cents: 1,
          lines: [],
        },
        false,
      ),
    ApiError,
  );
  assertEquals(
    validateInvoiceBody(
      {
        purchase_order_number: "PO-99",
        discount_cents: 100,
      },
      true,
    ),
    { purchase_order_number: "PO-99", discount_cents: 100 },
  );
  assertThrows(() => validateInvoiceBody({}, true), ApiError);
  assertThrows(
    () => validateInvoiceBody({ client_id: null }, true),
    ApiError,
  );
  assertThrows(
    () =>
      decodeInvoiceCursor(
        btoa(JSON.stringify({ created_at: "not-a-date", id: clientId }))
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replace(/=+$/, ""),
      ),
    ApiError,
  );
});

Deno.test("invoice void_reason is required for the /void action body", () => {
  assertThrows(
    () =>
      validateInvoiceBody(
        {
          client_id: "22222222-2222-4222-8222-222222222222",
          void_reason: "Duplicate invoice",
          lines: [],
        },
        false,
      ),
    ApiError,
  );
});

Deno.test("invoice create accepts optional number; PATCH rejects number", () => {
  const clientId = "22222222-2222-4222-8222-222222222222";
  const created = validateInvoiceBody(
    {
      client_id: clientId,
      number: "  LEGACY-42  ",
      lines: [],
    },
    false,
  );
  assertEquals(created.number, "LEGACY-42");
  assertThrows(
    () =>
      validateInvoiceBody(
        {
          number: "LEGACY-99",
        },
        true,
      ),
    ApiError,
  );
});

Deno.test("invoice send body accepts optional sent_at ISO timestamptz", () => {
  assertEquals(validateSendInvoiceBody({}), {});
  assertEquals(
    validateSendInvoiceBody({ sent_at: "2024-06-15T12:00:00Z" }),
    { sent_at: "2024-06-15T12:00:00Z" },
  );
  assertThrows(
    () => validateSendInvoiceBody({ sent_at: "not-a-timestamp" }),
    ApiError,
  );
  assertThrows(
    () =>
      validateSendInvoiceBody({ sent_at: "2024-06-15T12:00:00Z", extra: true }),
    ApiError,
  );
});

Deno.test("bill create validation requires vendor_id and number", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const body = validateBillBody(
    {
      vendor_id: id,
      number: "V-1",
      currency: "gbp",
      lines: [{
        description: "Paper",
        quantity: 1,
        unit_price_cents: 100,
        position: 0,
      }],
    },
    false,
  );
  assertEquals(body.currency, "GBP");
  assertEquals(body.vendor_id, id);
  assertEquals(body.number, "V-1");
  assertThrows(() => validateBillBody({ number: "V-1" }, false), ApiError);
  assertThrows(
    () => validateBillBody({ vendor_id: id, total_cents: 1 }, false),
    ApiError,
  );
});

Deno.test("vendor create validation defaults status and rejects unknown fields", () => {
  const body = validateVendorBody(
    { name: "Acme Vendor", primary_email: "vendor@example.test" },
    false,
  );
  assertEquals(body.status, "active");
  assertEquals(body.name, "Acme Vendor");
  assertEquals(body.primary_email, "vendor@example.test");
  assertThrows(
    () =>
      validateVendorBody(
        { name: "X", bank_details_encrypted: "secret" },
        false,
      ),
    ApiError,
  );
  assertThrows(
    () =>
      validateVendorBody({ name: "X", primary_email: "not-an-email" }, false),
    ApiError,
  );
});

Deno.test("vendor bank details body accepts trimmed plaintext only", () => {
  assertEquals(
    validateVendorBankDetailsBody({ bank_details: "  IBAN GB00  " }),
    { bank_details: "IBAN GB00" },
  );
  assertThrows(
    () => validateVendorBankDetailsBody({ bank_details: "" }),
    ApiError,
  );
  assertThrows(
    () => validateVendorBankDetailsBody({ bank_details: "x", extra: true }),
    ApiError,
  );
});

Deno.test("task create validation defaults priority/status/source and rejects reserved fields", () => {
  const body = validateTaskBody({ title: "Ship Tasks BE" }, false);
  assertEquals(body.title, "Ship Tasks BE");
  assertEquals(body.priority, "p3");
  assertEquals(body.status, "open");
  assertEquals(body.source, "manual");
  assertEquals(body.position, 0);
  assertThrows(
    () =>
      validateTaskBody(
        { title: "X", assignee_agent_id: crypto.randomUUID() },
        false,
      ),
    ApiError,
  );
  assertThrows(
    () => validateTaskBody({ title: "X", entity_type: "contact" }, false),
    ApiError,
  );
  assertThrows(
    () => validateTaskBody({ title: "X", priority: "urgent" }, false),
    ApiError,
  );
  const withProject = validateTaskBody({
    title: "Project-linked task",
    entity_type: "project",
    entity_id: "11111111-1111-4111-8111-111111111111",
  }, false);
  assertEquals(withProject.entity_type, "project");
  assertEquals(withProject.entity_id, "11111111-1111-4111-8111-111111111111");
  const patched = validateTaskBody({
    status: "blocked",
    blocked_reason: "Waiting",
  }, true);
  assertEquals(patched.status, "blocked");
  assertEquals(patched.blocked_reason, "Waiting");
});

Deno.test("task cursor round-trip shape", () => {
  const createdAt = "2026-08-02T18:00:00.000Z";
  const id = "11111111-1111-4111-8111-111111111111";
  const encoded = btoa(JSON.stringify({ created_at: createdAt, id }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  const decoded = decodeTaskCursor(encoded);
  assertEquals(decoded.created_at, createdAt);
  assertEquals(decoded.id, id);
  assertThrows(() => decodeTaskCursor("not-a-cursor"), ApiError);
});

Deno.test("meeting create validation accepts structured attendees and project related entity", () => {
  const starts = "2026-08-10T10:00:00.000Z";
  const ends = "2026-08-10T11:00:00.000Z";
  const body = validateMeetingBody(
    {
      title: "Kickoff",
      starts_at: starts,
      ends_at: ends,
      timezone: "Europe/London",
      status: "in_progress",
      attendees: [
        { email: "ada@example.test", name: "Ada", organiser: true },
        { email: "bob@example.test" },
      ],
    },
    false,
  );
  assertEquals(body.title, "Kickoff");
  assertEquals(body.status, "in_progress");
  assertEquals(body.timezone, "Europe/London");
  assertEquals(body.attendees?.length, 2);
  assertEquals(body.attendees?.[0]?.email, "ada@example.test");
  assertEquals(body.attendees?.[0]?.organiser, true);
  const withProject = validateMeetingBody(
    {
      title: "Project sync",
      starts_at: starts,
      ends_at: ends,
      related_entity_type: "project",
      related_entity_id: "11111111-1111-4111-8111-111111111111",
    },
    false,
  );
  assertEquals(withProject.related_entity_type, "project");
  assertThrows(
    () =>
      validateMeetingBody(
        {
          title: "Bad",
          starts_at: starts,
          ends_at: "2026-08-10T09:00:00.000Z",
        },
        false,
      ),
    ApiError,
  );
  const patched = validateMeetingBody(
    {
      attendees: [{ email: "only@example.test", organiser: false }],
    },
    true,
  );
  assertEquals(patched.attendees?.length, 1);
});

Deno.test("project create validation allows null client_id for internal projects", () => {
  assertThrows(
    () =>
      validateProjectBody({ name: "Rollout", client_id: "not-a-uuid" }, false),
    ApiError,
  );
  const internal = validateProjectBody({ name: "Ops handbook" }, false);
  assertEquals(internal.client_id, null);
  assertEquals(internal.name, "Ops handbook");
  const created = validateProjectBody(
    {
      client_id: "11111111-1111-4111-8111-111111111111",
      name: "Website relaunch",
      status: "active",
    },
    false,
  );
  assertEquals(created.client_id, "11111111-1111-4111-8111-111111111111");
  assertEquals(created.name, "Website relaunch");
  assertEquals(created.status, "active");
  assertThrows(
    () =>
      validateProjectBody(
        {
          client_id: "11111111-1111-4111-8111-111111111111",
          name: "Bad status",
          status: "paused",
        },
        false,
      ),
    ApiError,
  );
  const patched = validateProjectBody({ status: "done", position: 42.5 }, true);
  assertEquals(patched.status, "done");
  assertEquals(patched.position, 42.5);
  const cleared = validateProjectBody({ client_id: null }, true);
  assertEquals(cleared.client_id, null);
});

Deno.test("project card validation requires title on create", () => {
  assertThrows(() => validateProjectCardBody({}, false), ApiError);
  const card = validateProjectCardBody({ title: "Scope discovery" }, false);
  assertEquals(card.title, "Scope discovery");
});

Deno.test("project status filter and cursor round-trip", () => {
  const url = new URL(
    "https://example.test/api/v1/projects?status=active,archived&status=blocked",
  );
  assertEquals(parseProjectStatusFilter(url), [
    "active",
    "archived",
    "blocked",
  ]);
  const createdAt = "2026-08-03T18:00:00.000Z";
  const id = "33333333-3333-4333-8333-333333333333";
  const encoded = btoa(JSON.stringify({ created_at: createdAt, id }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  const decoded = decodeProjectCursor(encoded);
  assertEquals(decoded.created_at, createdAt);
  assertEquals(decoded.id, id);
  assertThrows(() => decodeProjectCursor("bad-cursor"), ApiError);
});

Deno.test("meeting cursor round-trip shape", () => {
  const createdAt = "2026-08-03T18:00:00.000Z";
  const startsAt = "2026-08-11T09:00:00.000Z";
  const id = "22222222-2222-4222-8222-222222222222";
  const encodedCreated = btoa(JSON.stringify({ created_at: createdAt, id }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  const decodedCreated = decodeMeetingCursor(encodedCreated, false);
  assertEquals(decodedCreated.created_at, createdAt);
  assertEquals(decodedCreated.id, id);
  const encodedStarts = btoa(JSON.stringify({ starts_at: startsAt, id }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  const decodedStarts = decodeMeetingCursor(encodedStarts, true);
  assertEquals(decodedStarts.starts_at, startsAt);
  assertEquals(decodedStarts.id, id);
  assertThrows(() => decodeMeetingCursor("not-a-cursor", false), ApiError);
});

Deno.test("meeting list range params validate and reject bad combos", () => {
  const ok = parseMeetingListRange(
    new URLSearchParams({
      starts_after: "2026-08-01T00:00:00.000Z",
      starts_before: "2026-08-31T23:59:59.000Z",
    }),
    false,
  );
  assertEquals(ok.rangeActive, true);
  assertEquals(ok.startsAfter, "2026-08-01T00:00:00.000Z");
  assertEquals(ok.startsBefore, "2026-08-31T23:59:59.000Z");

  const afterOnly = parseMeetingListRange(
    new URLSearchParams({ starts_after: "2026-08-01T00:00:00Z" }),
    false,
  );
  assertEquals(afterOnly.rangeActive, true);
  assertEquals(afterOnly.startsBefore, null);

  assertEquals(
    parseMeetingListRange(new URLSearchParams(), false).rangeActive,
    false,
  );

  assertThrows(
    () =>
      parseMeetingListRange(
        new URLSearchParams({ starts_after: "2026-08-01T00:00:00.000Z" }),
        true,
      ),
    ApiError,
  );
  assertThrows(
    () =>
      parseMeetingListRange(
        new URLSearchParams({
          starts_after: "2026-08-31T00:00:00.000Z",
          starts_before: "2026-08-01T00:00:00.000Z",
        }),
        false,
      ),
    ApiError,
  );
  assertThrows(
    () =>
      parseMeetingListRange(
        new URLSearchParams({ starts_after: "not-a-date" }),
        false,
      ),
    ApiError,
  );
});

Deno.test("tax rate and profile preference validation", () => {
  assertEquals(
    validateTaxRateBody(
      { name: "VAT", rate_percent: 20, is_default: true },
      false,
    ),
    { name: "VAT", rate_percent: 20, is_default: true, active: true },
  );
  assertThrows(
    () => validateTaxRateBody({ name: "Bad", rate_percent: Number.NaN }, false),
    ApiError,
  );
  assertThrows(
    () =>
      validateTaxRateBody(
        { name: "Bad", rate_percent: 20, org_id: "x" },
        false,
      ),
    ApiError,
  );
  assertThrows(() => validateTaxRateBody({}, true), ApiError);
  assertEquals(
    validateTaxRateBody({ name: "Renamed" }, true),
    { name: "Renamed" },
  );
  assertEquals(
    validateProfilePreferencesBody({ theme_preference: null }),
    { theme_preference: null },
  );
  assertThrows(
    () => validateProfilePreferencesBody({ theme_preference: "neon" }),
    ApiError,
  );
});

Deno.test("rewriteStorageSignedUrl rewrites kong origin to public base", () => {
  const kong =
    "http://kong:8000/storage/v1/object/upload/sign/org-documents/org/x/doc.pdf?token=abc";
  assertEquals(
    rewriteStorageSignedUrl(kong, "http://192.168.5.136:54321"),
    "http://192.168.5.136:54321/storage/v1/object/upload/sign/org-documents/org/x/doc.pdf?token=abc",
  );
  assertEquals(
    rewriteStorageSignedUrl(kong, "http://192.168.5.136:54321/"),
    "http://192.168.5.136:54321/storage/v1/object/upload/sign/org-documents/org/x/doc.pdf?token=abc",
  );
});

Deno.test("rewriteStorageSignedUrl is a no-op when public base unset", () => {
  const kong =
    "http://kong:8000/storage/v1/object/sign/org-documents/y?token=z";
  assertEquals(rewriteStorageSignedUrl(kong, null), kong);
  assertEquals(rewriteStorageSignedUrl(kong, ""), kong);
  assertEquals(rewriteStorageSignedUrl(kong, "   "), kong);
});

Deno.test("resolveStoragePublicBase prefers STORAGE_PUBLIC_URL over PUBLIC_SUPABASE_URL", () => {
  const env: Record<string, string> = {
    PUBLIC_SUPABASE_URL: "http://192.168.5.136:54321",
    STORAGE_PUBLIC_URL: "http://files.example.test:9000",
  };
  assertEquals(
    resolveStoragePublicBase((key) => env[key]),
    "http://files.example.test:9000",
  );
  delete env.STORAGE_PUBLIC_URL;
  assertEquals(
    resolveStoragePublicBase((key) => env[key]),
    "http://192.168.5.136:54321",
  );
  assertEquals(resolveStoragePublicBase(() => undefined), null);
});

Deno.test("document upload intent validation defaults and rejects bad digests/sizes", () => {
  const ok = validateUploadIntentBody({
    name: " contract.pdf ",
    category: "contract",
    mime_type: "application/pdf",
    size_bytes: 1024,
    sha256: "a".repeat(64),
    folder_id: null,
  });
  assertEquals(ok.name, "contract.pdf");
  assertEquals(ok.sha256, "a".repeat(64));

  assertThrows(
    () =>
      validateUploadIntentBody({
        name: "x",
        category: "contract",
        mime_type: "application/pdf",
        size_bytes: 1024,
        sha256: "nope",
      }),
    ApiError,
  );
  assertThrows(
    () =>
      validateUploadIntentBody({
        name: "x",
        category: "contract",
        mime_type: "application/pdf",
        size_bytes: 60_000_000,
        sha256: "a".repeat(64),
        storage_path: "evil",
      }),
    ApiError,
  );
});

Deno.test("document folder create validation trims name and allows null parent", () => {
  const ok = validateFolderCreateBody({ name: " Contracts ", parent_id: null });
  assertEquals(ok.name, "Contracts");
  assertEquals(ok.parent_id, null);
  assertThrows(() => validateFolderCreateBody({ name: "" }), ApiError);
});

Deno.test("document entity types accept bill and reject unknown values", () => {
  assertEquals(parseDocumentEntityType("bill"), "bill");
  assertEquals(parseDocumentEntityType("client"), "client");
  assertThrows(() => parseDocumentEntityType("invoice"), ApiError);
});

Deno.test("mailbox validation normalises email and rejects empty password rotate", () => {
  const ok = validateMailboxBody({
    email_address: "  Ada@Example.TEST ",
    from_name: " Ada ",
    imap_host: "imap.example.test",
    imap_port: 993,
    imap_security: "tls",
    smtp_host: "smtp.example.test",
    smtp_port: 587,
    smtp_security: "starttls",
    username: "ada@example.test",
    password: "secret-pass",
  });
  assertEquals(ok.email_address, "ada@example.test");
  assertEquals(ok.from_name, "Ada");
  assertEquals(ok.password, "secret-pass");

  assertThrows(
    () =>
      validateMailboxBody({
        email_address: "ada@example.test",
        imap_host: "imap.example.test",
        imap_port: 993,
        imap_security: "tls",
        smtp_host: "smtp.example.test",
        smtp_port: 587,
        smtp_security: "tls",
        username: "ada",
        password: "",
      }),
    ApiError,
  );
  assertThrows(
    () =>
      validateMailboxBody({
        email_address: "not-an-email",
        imap_host: "imap.example.test",
        imap_port: 993,
        imap_security: "tls",
        smtp_host: "smtp.example.test",
        smtp_port: 587,
        smtp_security: "tls",
        username: "ada",
      }),
    ApiError,
  );
});

Deno.test("mailbox test body accepts optional password only", () => {
  assertEquals(validateMailboxTestBody({}), { password: null });
  assertEquals(validateMailboxTestBody({ password: "x" }), { password: "x" });
  assertThrows(() => validateMailboxTestBody({ password: "" }), ApiError);
  assertThrows(() => validateMailboxTestBody({ host: "nope" }), ApiError);
});

Deno.test("AI connect validation requires api_key and parses providers", () => {
  assertEquals(
    validateAiConnectBody({ api_key: "sk-test-123456" }).api_key,
    "sk-test-123456",
  );
  assertThrows(() => validateAiConnectBody({ api_key: "short" }), ApiError);
  assertThrows(
    () => validateAiConnectBody({ api_key: "sk-test-123456", oauth: true }),
    ApiError,
  );
  assertEquals(
    validateAiModelBody({ model: "gpt-4o-mini" }).model,
    "gpt-4o-mini",
  );
  assertThrows(() => validateAiModelBody({ model: "" }), ApiError);
  assertThrows(
    () => validateAiModelBody({ model: "gpt-4o", extra: true }),
    ApiError,
  );
  assertEquals(parseAiProvider("openai"), "openai");
  assertEquals(parseAiProvider("openrouter"), "openrouter");
  assertThrows(() => parseAiProvider("azure"), ApiError);
});

Deno.test("secret-echo guard treats auth_mode api_key value as safe, keys as forbidden", () => {
  assertEquals(
    payloadHasForbiddenSecretKey({
      provider: "openai",
      config: { auth_mode: "api_key" },
      credentials_configured: true,
    }),
    false,
  );
  assertEquals(payloadHasForbiddenSecretKey({ api_key: "sk-leaked" }), true);
  assertEquals(payloadHasForbiddenSecretKey({ secret_ref: "x" }), true);
  assertEquals(payloadHasForbiddenSecretKey({ password: "x" }), true);
});

Deno.test("meeting PATCH rejects calendar_provider and external_event_id as not writable", () => {
  assertThrows(
    () => validateMeetingBody({ calendar_provider: "google" }, true),
    ApiError,
  );
  assertThrows(
    () => validateMeetingBody({ external_event_id: "evt-1" }, true),
    ApiError,
  );
  try {
    validateMeetingBody({
      calendar_provider: "google",
      external_event_id: "evt-1",
    }, true);
    throw new Error("expected validation error");
  } catch (err) {
    assertEquals(err instanceof ApiError, true);
    const fields = (err as ApiError).fields ?? {};
    assertEquals(fields.calendar_provider, "Field is not writable");
    assertEquals(fields.external_event_id, "Field is not writable");
  }
});

Deno.test("calendar OAuth callback params require code and state", () => {
  assertEquals(
    validateOAuthCallbackParams({ code: "abc", state: "1234567890abcdef" }),
    { code: "abc", state: "1234567890abcdef" },
  );
  assertThrows(
    () =>
      validateOAuthCallbackParams({ code: null, state: "1234567890abcdef" }),
    ApiError,
  );
  assertThrows(
    () => validateOAuthCallbackParams({ code: "abc", state: "short" }),
    ApiError,
  );
});

Deno.test("calendar secret-echo guard forbids token keys", () => {
  assertEquals(
    calendarPayloadHasForbiddenSecretKey({
      provider: "google",
      credentials_configured: true,
      config: { account_email: "a@example.test" },
    }),
    false,
  );
  assertEquals(
    calendarPayloadHasForbiddenSecretKey({ refresh_token: "x" }),
    true,
  );
  assertEquals(
    calendarPayloadHasForbiddenSecretKey({ access_token: "x" }),
    true,
  );
  assertEquals(calendarPayloadHasForbiddenSecretKey({ token_blob: "x" }), true);
  assertEquals(calendarPayloadHasForbiddenSecretKey({ secret_ref: "x" }), true);
});

Deno.test("google calendar stub client and auth url helpers", async () => {
  const client = createStubGoogleCalendarClient("meeting-1");
  const created = await client.insertEvent("primary", {
    title: "Sync",
    starts_at: "2026-08-10T10:00:00.000Z",
    ends_at: "2026-08-10T11:00:00.000Z",
    timezone: "UTC",
  });
  assertEquals(created.id, "stub-meeting-1");
  const patched = await client.patchEvent("primary", created.id, {
    title: "Sync 2",
    starts_at: "2026-08-10T10:00:00.000Z",
    ends_at: "2026-08-10T11:00:00.000Z",
    timezone: "UTC",
  });
  assertEquals(patched.id, "stub-meeting-1");
  await client.deleteEvent("primary", created.id);

  const url = buildGoogleAuthUrl({
    clientId: "cid",
    redirectUri: "https://example.test/callback",
    state: "state-token-abcdefgh",
  });
  assertEquals(url.includes("accounts.google.com"), true);
  assertEquals(url.includes("state=state-token-abcdefgh"), true);
  assertEquals(parseTokenBlob('{"stub":true,"refresh_token":"r"}').stub, true);
  assertEquals(parseTokenBlob("raw-refresh").refresh_token, "raw-refresh");
  assertEquals(isCalendarSyncStubMode(() => "1"), true);
  assertEquals(isCalendarSyncStubMode(() => undefined), false);
  assertEquals(isMailboxOAuthStubMode(() => "yes"), true);
  assertEquals(isMailboxOAuthStubMode(() => ""), false);
});

Deno.test("caldav upsert validation requires url username provider", () => {
  const ok = validateCaldavUpsertBody({
    provider: "caldav",
    caldav_url: "https://caldav.example.test/SOGo/dav/user/Calendar/personal/",
    username: "user@example.test",
    password: "app-pass",
  });
  assertEquals(ok.provider, "caldav");
  assertEquals(ok.username, "user@example.test");
  assertEquals(ok.password, "app-pass");

  assertThrows(
    () =>
      validateCaldavUpsertBody({
        provider: "google",
        caldav_url: "https://caldav.example.test/cal/",
        username: "u",
        password: "p",
      }),
    ApiError,
  );
  assertThrows(
    () =>
      validateCaldavUpsertBody({
        provider: "caldav",
        caldav_url: "not-a-url",
        username: "u",
        password: "p",
      }),
    ApiError,
  );
});

Deno.test("caldav client helpers + stub put/delete", async () => {
  assertEquals(isSyntheticCaldavHost("caldav.example.test"), true);
  assertEquals(
    hostnameFromCaldavUrl("https://caldav.example.test/path/"),
    "caldav.example.test",
  );
  assertEquals(icsEscapeText("a;b,c\nd\\e"), "a\\;b\\,c\\nd\\\\e");
  assertEquals(
    toIcsUtcDateTime("2026-09-02T10:30:00.000Z"),
    "20260902T103000Z",
  );
  assertEquals(
    eventObjectUrl("https://caldav.example.test/cal/", "abc-123"),
    "https://caldav.example.test/cal/abc-123.ics",
  );
  assertEquals(parseCaldavSecretBlob('{"password":"x"}').password, "x");
  assertEquals(parseCaldavSecretBlob("plain").password, "plain");
  assertEquals(isCaldavSyncStubMode(() => "1"), true);

  const ics = buildVeventIcs({
    uid: "meeting-1",
    title: "Sync; now",
    starts_at: "2026-09-02T10:00:00.000Z",
    ends_at: "2026-09-02T10:30:00.000Z",
    timezone: "UTC",
    meeting_url: "https://meet.example.test/x",
  });
  assertEquals(ics.includes("UID:meeting-1"), true);
  assertEquals(ics.includes("SUMMARY:Sync\\; now"), true);
  assertEquals(ics.includes("Meeting URL:"), true);

  const client = createStubCaldavClient("meeting-1");
  const created = await client.putEvent({
    uid: "meeting-1",
    title: "Sync",
    starts_at: "2026-09-02T10:00:00.000Z",
    ends_at: "2026-09-02T10:30:00.000Z",
    timezone: "UTC",
  });
  assertEquals(created.id, "stub-meeting-1");
  await client.deleteEvent(created.id);
  await client.propfind();
});

Deno.test("email share validation requires entity_type and entity_id UUID", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assertEquals(validateShareBody({ entity_type: "contact", entity_id: id }), {
    entity_type: "contact",
    entity_id: id,
  });
  assertThrows(
    () => validateShareBody({ entity_type: "invoice", entity_id: id }),
    ApiError,
  );
  assertThrows(
    () => validateShareBody({ entity_type: "contact", entity_id: "nope" }),
    ApiError,
  );
  assertThrows(
    () =>
      validateShareBody({ entity_type: "contact", entity_id: id, extra: true }),
    ApiError,
  );
});

Deno.test("AI email_reply generate/decide validation", () => {
  const id = "22222222-2222-4222-8222-222222222222";
  assertEquals(validateGenerateBody({ email_message_id: id }), {
    email_message_id: id,
    variant: "neutral",
  });
  assertEquals(
    validateGenerateBody({ email_message_id: id, variant: "warm" }).variant,
    "warm",
  );
  assertThrows(() => validateGenerateBody({ email_message_id: "x" }), ApiError);
  assertEquals(validateDecideBody({}), { accepted_text: null });
  assertEquals(validateDecideBody({ accepted_text: "Edited" }), {
    accepted_text: "Edited",
  });
  assertThrows(() => validateDecideBody({ accepted_text: 1 }), ApiError);
  assertThrows(() => validateDecideBody({ send: true }), ApiError);
});

Deno.test("AI invoice_chase generate validation", () => {
  const id = "33333333-3333-4333-8333-333333333333";
  assertEquals(validateInvoiceChaseBody({ invoice_id: id }), {
    invoice_id: id,
    variant: "polite",
  });
  assertEquals(
    validateInvoiceChaseBody({ invoice_id: id, variant: "firm" }).variant,
    "firm",
  );
  assertThrows(() => validateInvoiceChaseBody({ invoice_id: "x" }), ApiError);
});

Deno.test("AI org prompts merge defaults and validate PUT body", () => {
  assertEquals(
    mergeEffectivePrompts({}).email_reply,
    DEFAULT_AI_PROMPTS.email_reply,
  );
  assertEquals(
    mergeEffectivePrompts({ email_reply: " Custom reply prompt " }).email_reply,
    " Custom reply prompt ",
  );
  assertEquals(validateAiPromptsPutBody({ email_reply: "Hello" }), {
    email_reply: "Hello",
  });
  assertEquals(validateAiPromptsPutBody({ email_reply: "  " }), {
    email_reply: null,
  });
  assertEquals(validateAiPromptsPutBody({ meeting_summary: null }), {
    meeting_summary: null,
  });
  assertThrows(() => validateAiPromptsPutBody({ nope: "x" }), ApiError);
  assertThrows(() => validateAiPromptsPutBody({}), ApiError);
});

Deno.test("AI output sanitize strips echoed TONE line", () => {
  assertEquals(
    sanitizeAiOutput("Thanks for the note.\n\nTONE: warm\n"),
    "Thanks for the note.",
  );
  assertEquals(
    sanitizeAiOutput("Keep this TONE: warm inside."),
    "Keep this TONE: warm inside.",
  );
});

Deno.test("AI meeting proposal JSON parse + stub fallback", () => {
  const parsed = parseMeetingProposalOutput(
    '```json\n[{"title":"Send pack","description":"Email the kickoff pack","confidence":0.9}]\n```',
    "line one\nline two",
    "Extract tasks",
  );
  assertEquals(parsed.length, 1);
  assertEquals(parsed[0].title, "Send pack");
  assertEquals(parsed[0].confidence, 0.9);

  const fallback = parseMeetingProposalOutput(
    "not json",
    "Alpha\nBeta",
    "Extract tasks",
  );
  assertEquals(fallback.length, 2);
  assertEquals(fallback[0].title, "Alpha");
});

Deno.test("AI completion stub path returns deterministic text", async () => {
  assertEquals(shouldStubAiCompletion("sk-test-openai-123"), true);
  assertEquals(shouldStubAiCompletion("sk-live-real-key"), false);
  const result = await completeAiPrompt({
    provider: "openai",
    apiKey: "sk-test-openai-proof",
    systemPrompt: "Draft a reply",
    userContent: "Source email\n\nHello",
  });
  assertEquals(result.provider, "openai");
  assertEquals(result.model.startsWith("stub-"), true);
  assertEquals(result.text.includes("Draft a reply"), true);
  assertEquals(result.text.includes("Source email"), true);
  assertEquals(typeof isAiCompletionStubMode(), "boolean");
});

Deno.test("AI stub keys return a local model catalog", async () => {
  const models = await listProviderModels(
    "openrouter",
    "sk-test-openrouter-catalog",
  );
  assertEquals(models.some((row) => row.id === "openai/gpt-4o-mini"), true);
  assertEquals(
    models.every((row) => row.id.length > 0 && row.label.length > 0),
    true,
  );
});

Deno.test("AI provider auth failure returns 409 CONFLICT (not 502)", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({ error: { message: "Incorrect API key" } }),
        {
          status: 401,
          headers: { "content-type": "application/json" },
        },
      ),
    );
  try {
    let caught: unknown;
    try {
      await completeAiPrompt({
        provider: "openrouter",
        apiKey: "sk-or-v1-not-real",
        systemPrompt: "Draft a reply",
        userContent: "Source email\n\nHello",
      });
    } catch (error) {
      caught = error;
    }
    assertEquals(caught instanceof ApiError, true);
    const apiError = caught as ApiError;
    assertEquals(apiError.status, 409);
    assertEquals(apiError.code, "CONFLICT");
    assertEquals(
      apiError.message,
      "openrouter rejected the API key — reconnect under Org → Integrations",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("recurring schedule validation defaults and frequency fields", () => {
  const clientId = "11111111-1111-4111-8111-111111111111";
  const body = validateRecurringScheduleBody({
    name: "Monthly retainer",
    client_id: clientId,
    frequency: "monthly",
    day_of_month: 1,
    lines: [{
      description_template: "Retainer {{period_start}}",
      quantity: 1,
      unit_price_cents: 1000,
    }],
  }, false);
  assertEquals(body.month_end_policy, "clamp");
  assertEquals(body.catch_up_policy, "latest");
  assertEquals(body.max_catch_up_runs, 1);
  assertEquals(body.pricing_mode, "fixed");
  assertEquals(body.local_run_time, "09:00:00");
  assertEquals(body.delivery_mode, "draft");
  assertEquals(body.lines.length, 1);

  assertThrows(
    () =>
      validateRecurringScheduleBody({
        name: "Weekly",
        client_id: clientId,
        frequency: "weekly",
        lines: [],
      }, false),
    ApiError,
  );

  const weekly = validateRecurringScheduleBody({
    name: "Weekly",
    client_id: clientId,
    frequency: "weekly",
    weekdays: [1, 3],
    lines: [{ description: "Hours", quantity: 2, unit_price_cents: 5000 }],
  }, false);
  assertEquals(weekly.weekdays, [1, 3]);
  assertEquals(weekly.lines[0].description_template, "Hours");

  assertThrows(
    () =>
      validateRecurringScheduleBody({
        name: "X",
        client_id: clientId,
        frequency: "hourly",
        lines: [],
      }, false),
    ApiError,
  );
});

Deno.test("run-now idempotency payload omits expected_version", async () => {
  const scheduleId = "11111111-1111-4111-8111-111111111111";
  assertEquals(recurringLifecycleIdempotencyPayload("run-now", scheduleId, 1), {
    schedule_id: scheduleId,
  });
  assertEquals(
    recurringLifecycleIdempotencyPayload("run-now", scheduleId, 99),
    {
      schedule_id: scheduleId,
    },
  );
  assertEquals(
    recurringLifecycleIdempotencyPayload("activate", scheduleId, 3),
    {
      schedule_id: scheduleId,
      expected_version: 3,
    },
  );

  const route = `/api/v1/recurring-invoice-schedules/${scheduleId}/run-now`;
  const hashV1 = await hashIdempotencyRequest(
    route,
    recurringLifecycleIdempotencyPayload("run-now", scheduleId, 1),
  );
  const hashV2 = await hashIdempotencyRequest(
    route,
    recurringLifecycleIdempotencyPayload("run-now", scheduleId, 2),
  );
  assertEquals(hashV1, hashV2);
});

Deno.test("payment create validation requires direction party and money fields", () => {
  const clientId = "11111111-1111-4111-8111-111111111111";
  const invoiceId = "22222222-2222-4222-8222-222222222222";
  assertEquals(
    validateCreateBody({
      direction: "inbound",
      client_id: clientId,
      amount_cents: 1200,
      currency: "gbp",
      method: "bank",
      allocations: [{ invoice_id: invoiceId, amount_cents: 1200 }],
    }),
    {
      direction: "inbound",
      client_id: clientId,
      amount_cents: 1200,
      currency: "GBP",
      method: "bank",
      provider: "manual",
      allocations: [{ invoice_id: invoiceId, amount_cents: 1200 }],
    },
  );
  assertThrows(
    () =>
      validateCreateBody({
        direction: "inbound",
        amount_cents: 100,
        currency: "GBP",
        method: "bank",
      }),
    ApiError,
  );
  assertThrows(
    () =>
      validateCreateBody({
        direction: "outbound",
        amount_cents: 100,
        currency: "GBP",
        method: "bank",
      }),
    ApiError,
  );
  assertThrows(
    () =>
      validateAllocateBody({
        allocations: [{
          invoice_id: invoiceId,
          bill_id: clientId,
          amount_cents: 1,
        }],
      }),
    ApiError,
  );
  assertEquals(validateReverseBody({ reason: " Duplicate " }), "Duplicate");
  assertThrows(() => validateReverseBody({}), ApiError);
  assertThrows(
    () =>
      decodePaymentCursor(
        btoa(JSON.stringify({ created_at: "not-a-date", id: clientId }))
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replace(/=+$/, ""),
      ),
    ApiError,
  );
});

Deno.test("payment allocate/reverse idempotency payload omits expected_version", async () => {
  const paymentId = "33333333-3333-4333-8333-333333333333";
  assertEquals(
    paymentMutationIdempotencyPayload(paymentId, { reason: "oops" }),
    { payment_id: paymentId, reason: "oops" },
  );
  const route = `/api/v1/payments/${paymentId}/reverse`;
  const hashV1 = await hashIdempotencyRequest(
    route,
    paymentMutationIdempotencyPayload(paymentId, { reason: "oops" }),
  );
  const hashV2 = await hashIdempotencyRequest(
    route,
    paymentMutationIdempotencyPayload(paymentId, { reason: "oops" }),
  );
  assertEquals(hashV1, hashV2);
});

Deno.test("A5 financial lifecycle idempotency payloads omit expected_version", async () => {
  const invoiceId = "44444444-4444-4444-8444-444444444444";
  const quoteId = "55555555-5555-4555-8555-555555555555";
  const billId = "66666666-6666-4666-8666-666666666666";

  assertEquals(invoiceLifecycleIdempotencyPayload(invoiceId), {
    invoice_id: invoiceId,
  });
  assertEquals(
    invoiceLifecycleIdempotencyPayload(invoiceId, { void_reason: "dup" }),
    { invoice_id: invoiceId, void_reason: "dup" },
  );
  assertEquals(quoteAcceptIdempotencyPayload(quoteId), { quote_id: quoteId });
  assertEquals(billLifecycleIdempotencyPayload(billId), { bill_id: billId });

  const sendRoute = `/api/v1/invoices/${invoiceId}/send`;
  const sendA = await hashIdempotencyRequest(
    sendRoute,
    invoiceLifecycleIdempotencyPayload(invoiceId),
  );
  const sendB = await hashIdempotencyRequest(
    sendRoute,
    invoiceLifecycleIdempotencyPayload(invoiceId),
  );
  assertEquals(sendA, sendB);

  const acceptRoute = `/api/v1/quotes/${quoteId}/accept`;
  assertEquals(
    await hashIdempotencyRequest(
      acceptRoute,
      quoteAcceptIdempotencyPayload(quoteId),
    ),
    await hashIdempotencyRequest(
      acceptRoute,
      quoteAcceptIdempotencyPayload(quoteId),
    ),
  );

  const receiveRoute = `/api/v1/bills/${billId}/receive`;
  assertEquals(
    await hashIdempotencyRequest(
      receiveRoute,
      billLifecycleIdempotencyPayload(billId),
    ),
    await hashIdempotencyRequest(
      receiveRoute,
      billLifecycleIdempotencyPayload(billId),
    ),
  );
});

Deno.test("timeline entity type and note body validation", () => {
  assertEquals(parseEntityType("quote"), "quote");
  assertThrows(() => parseEntityType("organisation"), ApiError);
  assertEquals(
    validateTimelineNoteBody({
      title: "  Follow up  ",
      body: "Called the client",
      payload: { accent: "slate", icon: "note" },
    }),
    {
      kind: "note",
      title: "Follow up",
      body: "Called the client",
      payload: { accent: "slate", icon: "note" },
    },
  );
  assertEquals(
    validateTimelineNoteBody({ kind: "call", title: "Dialed" }),
    { kind: "call", title: "Dialed", body: null, payload: {} },
  );
  assertThrows(
    () => validateTimelineNoteBody({ kind: "conversion", title: "Nope" }),
    ApiError,
  );
  assertThrows(() => validateTimelineNoteBody({ title: "" }), ApiError);
  assertThrows(
    () => validateTimelineNoteBody({ title: "X", payload: [] }),
    ApiError,
  );
  const memberId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  assertEquals(
    validateTimelineNoteBody({
      title: "Ping",
      payload: {
        mentions: [{ membership_id: memberId, display_name: "Ada" }],
      },
    }).payload,
    {
      mentions: [{ membership_id: memberId, display_name: "Ada" }],
    },
  );
  assertThrows(
    () =>
      validateTimelineNoteBody({
        title: "Ping",
        payload: { mentions: [{ display_name: "Ada" }] },
      }),
    ApiError,
  );
});

Deno.test("timeline cursor decode accepts occurred_at keyset", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const occurredAt = "2026-08-03T12:00:00.000Z";
  const encoded = btoa(JSON.stringify({ occurred_at: occurredAt, id }));
  assertEquals(decodeTimelineCursor(encoded), { occurred_at: occurredAt, id });
  assertEquals(decodeTimelineCursor(null), null);
  assertThrows(() => decodeTimelineCursor("%%%"), ApiError);
});

Deno.test("org timeline path matcher and cursor accept +00:00", () => {
  assertEquals(isOrgTimelineEventsPath("/api/v1/timeline-events"), true);
  assertEquals(
    isOrgTimelineEventsPath(
      "/api/v1/entities/quote/11111111-1111-4111-8111-111111111111/timeline-events",
    ),
    false,
  );
  const id = "33333333-3333-4333-8333-333333333333";
  const occurredAt = "2026-08-05T12:00:00+00:00";
  const encoded = btoa(JSON.stringify({ occurred_at: occurredAt, id }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  assertEquals(decodeTimelineCursor(encoded), { occurred_at: occurredAt, id });
});

Deno.test("audit cursor decode accepts created_at keyset", () => {
  const id = "22222222-2222-4222-8222-222222222222";
  const createdAt = "2026-08-03T15:00:00.000Z";
  const encoded = btoa(JSON.stringify({ created_at: createdAt, id }));
  assertEquals(decodeAuditCursor(encoded), { created_at: createdAt, id });
  assertEquals(decodeAuditCursor(null), null);
  assertThrows(() => decodeAuditCursor("%%%"), ApiError);
  assertThrows(
    () => decodeAuditCursor(btoa(JSON.stringify({ created_at: "nope", id }))),
    ApiError,
  );
});

Deno.test("notification cursor decode accepts created_at keyset", () => {
  const id = "33333333-3333-4333-8333-333333333333";
  const createdAt = "2026-08-04T13:00:00.000Z";
  const encoded = btoa(JSON.stringify({ created_at: createdAt, id }));
  assertEquals(decodeNotificationCursor(encoded), {
    created_at: createdAt,
    id,
  });
  assertEquals(decodeNotificationCursor(null), null);
  assertThrows(() => decodeNotificationCursor("%%%"), ApiError);
  assertThrows(
    () =>
      decodeNotificationCursor(
        btoa(JSON.stringify({ created_at: "nope", id })),
      ),
    ApiError,
  );
});

Deno.test("audit action and category filters accept machine codes", () => {
  assertEquals(parseAuditActionFilter(null), null);
  assertEquals(parseAuditActionFilter("org.name_changed"), "org.name_changed");
  assertThrows(() => parseAuditActionFilter("Org.Name"), ApiError);
  assertEquals(parseAuditCategoryFilter("org"), "org");
  assertThrows(() => parseAuditCategoryFilter("org.name"), ApiError);
});

Deno.test("email template create validation defaults status and merge_schema", () => {
  assertEquals(
    validateEmailTemplateBody(
      {
        name: "  Chase overdue  ",
        subject: "Invoice {{number}}",
        body_text: "Please pay",
        category: "chase",
      },
      false,
    ),
    {
      name: "Chase overdue",
      subject: "Invoice {{number}}",
      body_text: "Please pay",
      category: "chase",
      status: "draft",
      merge_schema: [],
    },
  );
  assertThrows(
    () =>
      validateEmailTemplateBody(
        { name: "X", subject: "Y", category: "nope" },
        false,
      ),
    ApiError,
  );
  assertThrows(() => validateEmailTemplateBody({ name: "X" }, false), ApiError);
  assertEquals(
    validateEmailTemplateBody({ status: "archived" }, true),
    { status: "archived" },
  );
});

Deno.test("API key secret shape and create body validation", async () => {
  assertEquals(isOrgApiKeySecret("crm_key_" + "a".repeat(32)), true);
  assertEquals(isOrgApiKeySecret("crm_key_short"), false);
  assertEquals(isOrgApiKeySecret("not_a_key"), false);

  const hash = await sha256Hex("crm_key_" + "b".repeat(32));
  assertEquals(hash.length, 64);
  assertEquals(/^[0-9a-f]{64}$/.test(hash), true);

  assertEquals(
    validateApiKeyCreateBody({ name: "Agent", role: "member" }),
    { name: "Agent", role: "member", expires_at: null },
  );
  assertThrows(() => validateApiKeyCreateBody({ name: "" }), ApiError);
  assertThrows(
    () => validateApiKeyCreateBody({ name: "X", role: "nope" }),
    ApiError,
  );
  assertThrows(
    () =>
      validateApiKeyCreateBody({
        name: "X",
        expires_at: "2000-01-01T00:00:00.000Z",
      }),
    ApiError,
  );
});

Deno.test("MCP create_task requires assignee_membership_id", () => {
  const createTask = listMcpTools().find((tool) => tool.name === "create_task");
  assertEquals(createTask?.inputSchema.required, [
    "title",
    "assignee_membership_id",
  ]);
  assertEquals(
    (createTask?.inputSchema.properties as Record<string, unknown>)
      ?.assignee_membership_id,
    { type: "string", format: "uuid" },
  );

  const membershipId = "11111111-1111-4111-8111-111111111111";
  assertEquals(
    requireCreateTaskAssignee({ assignee_membership_id: membershipId }),
    membershipId,
  );
  assertThrows(() => requireCreateTaskAssignee({}), ApiError);
  assertThrows(
    () => requireCreateTaskAssignee({ assignee_membership_id: null }),
    ApiError,
  );
  assertThrows(
    () => requireCreateTaskAssignee({ assignee_membership_id: "" }),
    ApiError,
  );
  assertThrows(
    () => requireCreateTaskAssignee({ assignee_membership_id: "not-a-uuid" }),
    ApiError,
  );
});

Deno.test("MCP tools/list catalog covers MVP + Wave A/B/C entity writes", () => {
  const names = listMcpTools().map((tool) => tool.name).sort();
  assertEquals(names, [
    "accept_quote",
    "add_timeline_note",
    "adjust_product_stock",
    "allocate_payment",
    "create_client",
    "create_contact",
    "create_invoice",
    "create_invoice_from_quote",
    "create_lead",
    "create_meeting",
    "create_payment",
    "create_product",
    "create_product_category",
    "create_project",
    "create_quote",
    "create_task",
    "get_client",
    "get_contact",
    "get_invoice",
    "get_lead",
    "get_meeting",
    "get_payment",
    "get_product",
    "get_product_category",
    "get_project",
    "get_quote",
    "get_task",
    "list_clients",
    "list_contacts",
    "list_invoices",
    "list_leads",
    "list_meetings",
    "list_payments",
    "list_product_categories",
    "list_products",
    "list_projects",
    "list_quotes",
    "list_tasks",
    "reject_quote",
    "reverse_payment",
    "send_invoice",
    "send_quote",
    "update_client",
    "update_contact",
    "update_invoice",
    "update_lead",
    "update_meeting",
    "update_product",
    "update_product_category",
    "update_project",
    "update_quote",
    "update_task",
    "void_invoice",
  ]);
});

Deno.test("MCP JSON-RPC parse rejects non-objects and bad jsonrpc", () => {
  assertEquals(
    parseJsonRpcRequest({ jsonrpc: "2.0", method: "tools/list", id: 1 }).method,
    "tools/list",
  );
  assertThrows(() => parseJsonRpcRequest([]), ApiError);
  assertThrows(
    () => parseJsonRpcRequest({ jsonrpc: "1.0", method: "ping" }),
    ApiError,
  );
});

Deno.test("MCP tool failure result keeps If-Match conflicts as isError tool results", () => {
  const result = mcpToolFailureResult(
    new ApiError(
      412,
      "PRECONDITION_FAILED",
      "Lead version does not match If-Match",
    ),
    "req-412",
  );
  assertEquals(result.isError, true);
  const structured = result.structuredContent as {
    error: { code: string; message: string; request_id: string };
  };
  assertEquals(structured.error.code, "PRECONDITION_FAILED");
  assertEquals(
    structured.error.message,
    "Lead version does not match If-Match",
  );
  assertEquals(structured.error.request_id, "req-412");
  const text = (result.content as { type: string; text: string }[])[0]?.text ??
    "";
  assertEquals(text.includes("PRECONDITION_FAILED"), true);
});

Deno.test("MCP tool failure result includes validation fields for agents", () => {
  const result = mcpToolFailureResult(
    new ApiError(422, "VALIDATION_ERROR", "Client validation failed", {
      primary_email: "Must be a valid email address",
    }),
    "req-422",
  );
  assertEquals(result.isError, true);
  const structured = result.structuredContent as {
    error: { fields?: Record<string, string> };
  };
  assertEquals(
    structured.error.fields?.primary_email,
    "Must be a valid email address",
  );
});

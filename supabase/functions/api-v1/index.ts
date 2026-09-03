import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from '@supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../_shared/database.ts'
import {
  extractBearerToken,
  handleApiKeys,
  isOrgApiKeySecret,
  resolveOrgApiKey,
  serviceRoleDb,
} from './api-keys.ts'
import { handleClients } from './clients.ts'
import { handleContacts } from './contacts.ts'
import { handleDocuments } from './documents.ts'
import { ApiError, apiPath, errorResponse, jsonResponse, parseLimit, parseUuid } from './http.ts'
import { handleAiSuggestions } from './ai-suggestions.ts'
import { composeEntityEmailMessage, handleEmailMessages } from './email-messages.ts'
import { handleIntegrations } from './integrations.ts'
import { handleOrgInvoiceEmail } from './org-invoice-email.ts'
import { createInvoiceFromQuoteRoute, handleInvoices } from './invoices.ts'
import { handleBills } from './bills.ts'
import { handleTasks } from './tasks.ts'
import { handleCalendar } from './calendar.ts'
import { handleMeetings } from './meetings.ts'
import { handleProjects } from './projects.ts'
import { handleRecurringInvoices } from './recurring-invoices.ts'
import { handlePayments } from './payments.ts'
import { handleVendors } from './vendors.ts'
import { handleLeads } from './leads.ts'
import { handleEmailTemplates } from './email-templates.ts'
import { handlePlaybooks } from './playbooks.ts'
import { handleCampaigns } from './campaigns.ts'
import { handleTags, isTagsPath } from './tags.ts'
import { handleOrganisationMailboxes } from './org-mailboxes.ts'
import { handleMailbox, listEntityEmailMessages, listMyEmailMessages } from './mailbox.ts'
import { handleNotifications } from './notifications.ts'
import { handleOrgMembers } from './org-members.ts'
import { handleDashboardSummary } from './dashboard.ts'
import { handleAuditEvents } from './audit-events.ts'
import { acceptInvitation, handleOrganisationAccess } from './organisation-access.ts'
import {
  handleOrganisationBranding,
  handleOrganisationConfiguration,
  handleOrganisationLogo,
  handleOrganisations,
} from './organisations.ts'
import { handleProductCategories } from './product-categories.ts'
import { handleProducts } from './products.ts'
import { handleProfilePreferences } from './profile-preferences.ts'
import { handleQuotes } from './quotes.ts'
import { handleTaxRates } from './tax-rates.ts'
import { handleMcp } from './mcp.ts'
import { handleOrgTimelineEvents, handleTimelineEvents } from './timeline-events.ts'
import { buildApiV1CorsHeaders, resolveApiKeyOrgId } from './org-context.ts'

const configuredCorsOrigin = Deno.env.get('API_CORS_ORIGIN')
if (!configuredCorsOrigin) {
  console.warn(
    'API_CORS_ORIGIN is not set; defaulting to "*". Set an explicit origin in production.',
  )
}
const corsHeaders = buildApiV1CorsHeaders(configuredCorsOrigin)
type MembershipRole = Database['public']['Tables']['memberships']['Row']['role']

type RequestAuth = {
  db: SupabaseClient<Database>
  userId: string | null
  membership: { id: string; role: MembershipRole }
  orgId: string
  actorType: 'user' | 'api_key'
  apiKeyId: string | null
}

function assertCanAccessPipeline(
  role: MembershipRole,
  method: string,
  resource: 'leads' | 'clients' | 'vendors',
): void {
  if (resource === 'leads' && role === 'billing') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members cannot access leads')
  }
  if (resource === 'clients' && role === 'billing' && method !== 'GET') {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Billing members can only read clients',
    )
  }
  if (resource === 'vendors' && role === 'billing' && method !== 'GET') {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Billing members can only read vendors',
    )
  }
  if (role === 'readonly' && method !== 'GET') {
    throw new ApiError(
      403,
      'FORBIDDEN',
      `Readonly members cannot modify ${resource}`,
    )
  }
}

function assertCanAccessCatalog(role: MembershipRole, method: string): void {
  if ((role === 'billing' || role === 'readonly') && method !== 'GET') {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'This membership cannot modify the product catalog',
    )
  }
}

function assertCanAccessQuotes(role: MembershipRole, method: string): void {
  if (role === 'billing') {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Billing members cannot access quotes',
    )
  }
  if (role === 'readonly' && method !== 'GET') {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Readonly members cannot modify quotes',
    )
  }
}

function assertCanAccessInvoices(role: MembershipRole, method: string): void {
  if (role === 'billing' && method !== 'GET') {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Billing members can only read invoices',
    )
  }
  if (role === 'readonly' && method !== 'GET') {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Readonly members cannot modify invoices',
    )
  }
}

function assertCanAccessBills(role: MembershipRole, method: string): void {
  if (role === 'billing' && method !== 'GET') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members can only read bills')
  }
  if (role === 'readonly' && method !== 'GET') {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Readonly members cannot modify bills',
    )
  }
}

function assertCanAccessTasks(role: MembershipRole, method: string): void {
  if (role === 'billing') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members cannot access tasks')
  }
  if (role === 'readonly' && method !== 'GET') {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Readonly members cannot modify tasks',
    )
  }
}

function assertCanAccessMeetings(role: MembershipRole, method: string): void {
  if (role === 'billing') {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Billing members cannot access meetings',
    )
  }
  if (role === 'readonly' && method !== 'GET') {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Readonly members cannot modify meetings',
    )
  }
}

function assertCanAccessProjects(role: MembershipRole, method: string): void {
  if (role === 'billing') {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Billing members cannot access projects',
    )
  }
  if (role === 'readonly' && method !== 'GET') {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Readonly members cannot modify projects',
    )
  }
}

function assertCanAccessRecurringInvoices(
  role: MembershipRole,
  method: string,
): void {
  if (role === 'billing' && method !== 'GET') {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Billing members can only read recurring invoices',
    )
  }
  if (role === 'readonly' && method !== 'GET') {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Readonly members cannot modify recurring invoices',
    )
  }
}

function assertCanAccessPayments(role: MembershipRole, method: string): void {
  if (role === 'billing' && method !== 'GET') {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Billing members can only read payments',
    )
  }
  if (role === 'readonly' && method !== 'GET') {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Readonly members cannot modify payments',
    )
  }
}

function isHeaderlessRoute(path: string): boolean {
  return (
    path === '/api/v1/health' ||
    path === '/api/v1/organisations' ||
    path === '/api/v1/invitations/accept' ||
    path === '/api/v1/profile/preferences'
  )
}

function requireUserId(userId: string | null): string {
  if (!userId) {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'This route requires a user-backed actor (JWT or API key with created_by)',
    )
  }
  return userId
}

async function routeOrgScoped(
  req: Request,
  path: string,
  auth: RequestAuth,
  requestId: string,
): Promise<Response> {
  const { db, userId, membership, orgId, actorType, apiKeyId } = auth

  if (path === '/api/v1/mcp') {
    if (actorType !== 'api_key' || !apiKeyId) {
      throw new ApiError(
        403,
        'FORBIDDEN',
        'MCP requires an organisation API key (Bearer crm_key_…)',
      )
    }
    return await handleMcp(
      req,
      {
        db,
        userId,
        membership,
        orgId,
        actorType: 'api_key',
        apiKeyId,
      },
      requestId,
    )
  }

  if (path === '/api/v1/api-keys' || path.startsWith('/api/v1/api-keys/')) {
    if (actorType === 'api_key') {
      throw new ApiError(403, 'FORBIDDEN', 'API keys cannot manage API keys')
    }
    return await handleApiKeys(
      req,
      db,
      path,
      orgId,
      membership.role,
      requestId,
    )
  }

  if (
    path === '/api/v1/organisation/invitations' ||
    path.startsWith('/api/v1/organisation/invitations/') ||
    path === '/api/v1/organisation/members' ||
    path.startsWith('/api/v1/organisation/members/')
  ) {
    if (actorType === 'api_key') {
      throw new ApiError(
        403,
        'FORBIDDEN',
        'API keys cannot manage organisation access',
      )
    }
    return await handleOrganisationAccess(
      req,
      db,
      path,
      orgId,
      membership.role,
      requestId,
    )
  }

  if (path === '/api/v1/organisation/configuration') {
    return await handleOrganisationConfiguration(
      req,
      db,
      path,
      orgId,
      membership.role,
      requestId,
    )
  }

  if (
    path === '/api/v1/organisation/mailboxes'
  ) {
    return await handleOrganisationMailboxes(
      req,
      db,
      path,
      orgId,
      membership.role,
      requestId,
    )
  }

  if (
    path === '/api/v1/organisation/invoice-email' ||
    path === '/api/v1/organisation/invoice-email/test'
  ) {
    return await handleOrgInvoiceEmail(
      req,
      db,
      path,
      orgId,
      membership.role,
      requestId,
    )
  }

  if (path === '/api/v1/organisation/branding') {
    return await handleOrganisationBranding(req, db, path, orgId, requestId)
  }

  if (
    path === '/api/v1/organisation/logo' ||
    path === '/api/v1/organisation/logo/upload-intent' ||
    path === '/api/v1/organisation/logo/finalize'
  ) {
    return await handleOrganisationLogo(
      req,
      db,
      path,
      orgId,
      membership.role,
      requestId,
    )
  }

  if (path === '/api/v1/me/mailbox/sync') {
    return await handleEmailMessages(
      req,
      db,
      path,
      orgId,
      membership.role,
      requestId,
    )
  }

  if (path === '/api/v1/me/email-messages') {
    return await listMyEmailMessages(
      req,
      db,
      orgId,
      membership.role,
      requestId,
    )
  }

  if (
    path === '/api/v1/me/notifications' ||
    path === '/api/v1/me/notifications/unread-count' ||
    path.startsWith('/api/v1/me/notifications/')
  ) {
    return await handleNotifications(
      req,
      db,
      path,
      orgId,
      membership.role,
      requestId,
    )
  }

  if (path === '/api/v1/me/org-members') {
    return await handleOrgMembers(
      req,
      db,
      path,
      orgId,
      membership.role,
      requestId,
    )
  }

  if (path === '/api/v1/dashboard/summary') {
    return await handleDashboardSummary(
      req,
      db,
      path,
      orgId,
      membership.role,
      requestId,
    )
  }

  if (path === '/api/v1/me/mailbox' || path.startsWith('/api/v1/me/mailbox/')) {
    return await handleMailbox(
      req,
      db,
      path,
      orgId,
      membership.role,
      requestId,
    )
  }

  if (
    path === '/api/v1/me/calendar' || path.startsWith('/api/v1/me/calendar/')
  ) {
    return await handleCalendar(
      req,
      db,
      path,
      orgId,
      membership.role,
      requestId,
    )
  }

  if (
    path === '/api/v1/email-templates' ||
    path.startsWith('/api/v1/email-templates/')
  ) {
    return await handleEmailTemplates(
      req,
      db,
      path,
      orgId,
      membership.role,
      requestId,
    )
  }

  if (isTagsPath(path)) {
    return await handleTags(req, db, path, orgId, membership.role, requestId)
  }

  if (path === '/api/v1/campaigns' || path.startsWith('/api/v1/campaigns/')) {
    return await handleCampaigns(
      req,
      db,
      path,
      orgId,
      membership.role,
      requestId,
    )
  }

  if (path === '/api/v1/playbooks' || path.startsWith('/api/v1/playbooks/')) {
    return await handlePlaybooks(
      req,
      db,
      path,
      orgId,
      membership.role,
      requestId,
    )
  }

  if (path === '/api/v1/integrations' || path.startsWith('/api/v1/integrations/')) {
    return await handleIntegrations(
      req,
      db,
      path,
      orgId,
      membership.role,
      requestId,
    )
  }

  if (
    path.startsWith('/api/v1/email-messages/') ||
    path.startsWith('/api/v1/ai-suggestions')
  ) {
    if (path.startsWith('/api/v1/ai-suggestions')) {
      return await handleAiSuggestions(
        req,
        db,
        path,
        orgId,
        membership.role,
        requestId,
      )
    }
    return await handleEmailMessages(
      req,
      db,
      path,
      orgId,
      membership.role,
      requestId,
    )
  }

  if (path === '/api/v1/tax-rates' || path.startsWith('/api/v1/tax-rates/')) {
    return await handleTaxRates(
      req,
      db,
      path,
      orgId,
      membership.role,
      requestId,
    )
  }

  const entityEmailMatch = path.match(
    /^\/api\/v1\/(contacts|leads|clients)\/([0-9a-f-]{36})\/email-messages$/i,
  )
  if (entityEmailMatch) {
    if (membership.role === 'billing') {
      throw new ApiError(
        403,
        'FORBIDDEN',
        'Billing members cannot access entity email',
      )
    }
    // Path segment is plural; stub expects singular entity type.
    const entityTypeByResource = {
      contacts: 'contact',
      leads: 'lead',
      clients: 'client',
    } as const
    const resource = entityEmailMatch[1]
      .toLowerCase() as keyof typeof entityTypeByResource
    const entityType = entityTypeByResource[resource]
    if (!entityType) {
      throw new ApiError(404, 'NOT_FOUND', 'Route not found')
    }
    if (req.method === 'POST') {
      return await composeEntityEmailMessage(
        req,
        db,
        orgId,
        entityType,
        entityEmailMatch[2],
        membership.role,
        requestId,
      )
    }
    if (req.method !== 'GET') {
      throw new ApiError(
        405,
        'METHOD_NOT_ALLOWED',
        'Method not allowed for entity email',
      )
    }
    return await listEntityEmailMessages(
      db,
      orgId,
      entityType,
      entityEmailMatch[2],
      requestId,
      parseLimit(new URL(req.url).searchParams.get('limit')),
    )
  }

  if (path === '/api/v1/contacts' || path.startsWith('/api/v1/contacts/')) {
    if (membership.role === 'billing') {
      throw new ApiError(
        403,
        'FORBIDDEN',
        'Billing members cannot access contacts',
      )
    }
    if (membership.role === 'readonly' && req.method !== 'GET') {
      throw new ApiError(
        403,
        'FORBIDDEN',
        'Readonly members cannot modify contacts',
      )
    }
    return await handleContacts(
      req,
      db,
      path,
      orgId,
      requestId,
      actorType === 'api_key' &&
        (req.method === 'POST' || req.method === 'PATCH')
        ? requireUserId(userId)
        : null,
    )
  }

  if (path === '/api/v1/leads' || path.startsWith('/api/v1/leads/')) {
    assertCanAccessPipeline(membership.role, req.method, 'leads')
    return await handleLeads(req, db, path, orgId, requestId)
  }

  if (path === '/api/v1/clients' || path.startsWith('/api/v1/clients/')) {
    assertCanAccessPipeline(membership.role, req.method, 'clients')
    return await handleClients(req, db, path, orgId, requestId)
  }

  if (path === '/api/v1/vendors' || path.startsWith('/api/v1/vendors/')) {
    assertCanAccessPipeline(membership.role, req.method, 'vendors')
    return await handleVendors(req, db, path, orgId, requestId)
  }

  if (
    path === '/api/v1/product-categories' ||
    path.startsWith('/api/v1/product-categories/')
  ) {
    assertCanAccessCatalog(membership.role, req.method)
    return await handleProductCategories(req, db, path, orgId, requestId)
  }

  if (path === '/api/v1/products' || path.startsWith('/api/v1/products/')) {
    assertCanAccessCatalog(membership.role, req.method)
    return await handleProducts(
      req,
      db,
      path,
      orgId,
      requestId,
      requireUserId(userId),
    )
  }

  // Compatibility alias; primary contract is POST /api/v1/invoices/from-quote.
  const quoteConvertMatch = path.match(
    /^\/api\/v1\/quotes\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/create-invoice$/i,
  )
  if (quoteConvertMatch) {
    assertCanAccessInvoices(membership.role, req.method)
    return await createInvoiceFromQuoteRoute(
      req,
      db,
      orgId,
      requestId,
      quoteConvertMatch[1],
    )
  }

  if (path === '/api/v1/quotes' || path.startsWith('/api/v1/quotes/')) {
    assertCanAccessQuotes(membership.role, req.method)
    return await handleQuotes(
      req,
      db,
      path,
      orgId,
      requestId,
      actorType === 'api_key' &&
        (req.method === 'GET' || req.method === 'POST' ||
          req.method === 'PATCH')
        ? requireUserId(userId)
        : null,
    )
  }

  if (path === '/api/v1/invoices' || path.startsWith('/api/v1/invoices/')) {
    assertCanAccessInvoices(membership.role, req.method)
    return await handleInvoices(
      req,
      db,
      path,
      orgId,
      requestId,
      actorType === 'api_key' &&
        (req.method === 'GET' || req.method === 'POST' ||
          req.method === 'PATCH')
        ? requireUserId(userId)
        : null,
    )
  }

  if (path === '/api/v1/bills' || path.startsWith('/api/v1/bills/')) {
    assertCanAccessBills(membership.role, req.method)
    return await handleBills(req, db, path, orgId, requestId)
  }

  if (path === '/api/v1/tasks' || path.startsWith('/api/v1/tasks/')) {
    assertCanAccessTasks(membership.role, req.method)
    return await handleTasks(
      req,
      db,
      path,
      orgId,
      membership.role,
      membership.id,
      requestId,
      actorType === 'api_key' && apiKeyId
        ? { actorType: 'api_key', apiKeyId }
        : { actorType: 'user' },
    )
  }

  if (path === '/api/v1/meetings' || path.startsWith('/api/v1/meetings/')) {
    assertCanAccessMeetings(membership.role, req.method)
    return await handleMeetings(
      req,
      db,
      path,
      orgId,
      membership.role,
      requestId,
      requireUserId(userId),
      membership.id,
    )
  }

  if (path === '/api/v1/projects' || path.startsWith('/api/v1/projects/')) {
    assertCanAccessProjects(membership.role, req.method)
    return await handleProjects(
      req,
      db,
      path,
      orgId,
      membership.role,
      requestId,
      actorType === 'api_key' && req.method === 'POST' ? requireUserId(userId) : null,
    )
  }

  if (
    path === '/api/v1/recurring-invoice-schedules' ||
    path.startsWith('/api/v1/recurring-invoice-schedules/')
  ) {
    assertCanAccessRecurringInvoices(membership.role, req.method)
    return await handleRecurringInvoices(req, db, path, orgId, requestId)
  }

  if (path === '/api/v1/payments' || path.startsWith('/api/v1/payments/')) {
    assertCanAccessPayments(membership.role, req.method)
    return await handlePayments(
      req,
      db,
      path,
      orgId,
      requestId,
      actorType === 'api_key' && req.method === 'POST' ? requireUserId(userId) : null,
    )
  }

  if (path === '/api/v1/timeline-events') {
    return await handleOrgTimelineEvents(
      req,
      db,
      path,
      orgId,
      membership.role,
      requestId,
    )
  }

  if (/^\/api\/v1\/entities\/[^/]+\/[^/]+\/timeline-events$/.test(path)) {
    const timelineActor = actorType === 'api_key' && apiKeyId
      ? { actorType: 'api_key' as const, apiKeyId }
      : { actorType: 'user' as const }
    if (timelineActor.actorType === 'user') {
      requireUserId(userId)
    }
    return await handleTimelineEvents(
      req,
      db,
      path,
      orgId,
      membership.role,
      userId,
      requestId,
      timelineActor,
    )
  }

  if (path === '/api/v1/audit-events') {
    return await handleAuditEvents(
      req,
      db,
      path,
      orgId,
      membership.role,
      requestId,
    )
  }

  if (
    path.startsWith('/api/v1/entities/') ||
    path.startsWith('/api/v1/documents/') ||
    path.startsWith('/api/v1/document-folders/')
  ) {
    return handleDocuments(
      req,
      db,
      path,
      orgId,
      membership.role,
      requestId,
    )
  }

  throw new ApiError(404, 'NOT_FOUND', 'Route not found')
}

function requestIdFrom(req: Request): string {
  const suppliedRequestId = req.headers.get('x-request-id')
  return suppliedRequestId && /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedRequestId)
    ? suppliedRequestId
    : crypto.randomUUID()
}

async function handleUserRequest(
  req: Request,
  db: SupabaseClient<Database>,
  userId: string,
  requestId: string,
): Promise<Response> {
  const path = apiPath(new URL(req.url).pathname)
  if (path === '/api/v1/health' && req.method === 'GET') {
    return jsonResponse(
      { data: { status: 'ok', api_version: 'v1' } },
      200,
      requestId,
    )
  }

  if (path === '/api/v1/organisations') {
    return await handleOrganisations(req, db, path, userId, requestId)
  }

  if (path === '/api/v1/invitations/accept') {
    if (req.method !== 'POST') {
      throw new ApiError(
        405,
        'METHOD_NOT_ALLOWED',
        'Method not allowed for invitation acceptance',
      )
    }
    return await acceptInvitation(req, db, requestId)
  }

  if (path === '/api/v1/profile/preferences') {
    return await handleProfilePreferences(req, db, path, userId, requestId)
  }

  if (isHeaderlessRoute(path)) {
    throw new ApiError(404, 'NOT_FOUND', 'Route not found')
  }

  const orgHeader = req.headers.get('x-org-id')
  if (!orgHeader) {
    throw new ApiError(
      400,
      'ORG_CONTEXT_REQUIRED',
      'X-Org-Id is required for organisation-scoped routes',
    )
  }
  const orgId = parseUuid(orgHeader, 'x-org-id')

  const { data: membership, error: membershipError } = await db
    .from('memberships')
    .select('id, role, status')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle()

  if (membershipError) {
    console.error('Membership lookup failed', {
      request_id: requestId,
      code: membershipError.code,
    })
    throw new ApiError(
      500,
      'INTERNAL_ERROR',
      'Organisation context validation failed',
    )
  }
  if (!membership) {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'No active membership for this organisation',
    )
  }

  return await routeOrgScoped(
    req,
    path,
    {
      db,
      userId,
      membership: { id: membership.id, role: membership.role },
      orgId,
      actorType: 'user',
      apiKeyId: null,
    },
    requestId,
  )
}

async function handleApiKeyRequest(
  req: Request,
  requestId: string,
): Promise<Response> {
  const path = apiPath(new URL(req.url).pathname)
  if (path === '/api/v1/health' && req.method === 'GET') {
    return jsonResponse(
      { data: { status: 'ok', api_version: 'v1' } },
      200,
      requestId,
    )
  }

  if (isHeaderlessRoute(path)) {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'API keys cannot call this route; use a user JWT',
    )
  }

  const token = extractBearerToken(req)
  if (!token || !isOrgApiKeySecret(token)) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid API key')
  }

  const resolved = await resolveOrgApiKey(token)
  const orgId = resolveApiKeyOrgId(req.headers.get('x-org-id'), resolved.org_id)
  const db = serviceRoleDb()
  // Prefer membership id from resolve RPC (no second Data API round-trip).
  let membershipId: string | null = resolved.creator_membership_id
  if (!membershipId && resolved.created_by) {
    const { data: creatorMembership, error: creatorError } = await db
      .from('memberships')
      .select('id')
      .eq('org_id', orgId)
      .eq('user_id', resolved.created_by)
      .eq('status', 'active')
      .maybeSingle()
    if (creatorError) {
      console.error('API key creator membership lookup failed', {
        request_id: requestId,
        code: creatorError.code,
        message: creatorError.message,
      })
      throw new ApiError(
        500,
        'INTERNAL_ERROR',
        'Organisation context validation failed',
      )
    }
    membershipId = creatorMembership?.id ?? null
  }

  // Routes that persist membership_id (tasks/meetings) need the minting user's membership.
  // Read routes (contacts list/get) ignore membership.id.
  const membershipForRoutes = {
    id: membershipId ?? '00000000-0000-4000-8000-000000000000',
    role: resolved.role,
  }

  return await routeOrgScoped(
    req,
    path,
    {
      db,
      userId: resolved.created_by,
      membership: membershipForRoutes,
      orgId,
      actorType: 'api_key',
      apiKeyId: resolved.id,
    },
    requestId,
  )
}

const userFetch = withSupabase(
  {
    auth: 'user',
    cors: { headers: corsHeaders },
  },
  async (req, ctx) => {
    const requestId = requestIdFrom(req)
    try {
      const userId = ctx.userClaims?.id
      if (!userId) {
        throw new ApiError(
          401,
          'UNAUTHENTICATED',
          'Authenticated user identity is unavailable',
        )
      }
      const db = ctx.supabase as unknown as SupabaseClient<Database>
      return await handleUserRequest(req, db, userId, requestId)
    } catch (error) {
      if (error instanceof ApiError) return errorResponse(error, requestId)
      console.error('Unhandled API error', {
        request_id: requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      return errorResponse(
        new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred'),
        requestId,
      )
    }
  },
)

const apiKeyFetch = withSupabase(
  {
    auth: 'none',
    cors: { headers: corsHeaders },
  },
  async (req) => {
    const requestId = requestIdFrom(req)
    try {
      return await handleApiKeyRequest(req, requestId)
    } catch (error) {
      if (error instanceof ApiError) return errorResponse(error, requestId)
      console.error('Unhandled API key error', {
        request_id: requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      return errorResponse(
        new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred'),
        requestId,
      )
    }
  },
)

export default {
  fetch: (req: Request): Promise<Response> => {
    const token = extractBearerToken(req)
    if (token && isOrgApiKeySecret(token)) {
      return apiKeyFetch(req)
    }
    return userFetch(req)
  },
}

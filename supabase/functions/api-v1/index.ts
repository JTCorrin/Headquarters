import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from '@supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../_shared/database.ts'
import { handleClients } from './clients.ts'
import { handleContacts } from './contacts.ts'
import { handleDocuments } from './documents.ts'
import { ApiError, apiPath, errorResponse, jsonResponse, parseUuid } from './http.ts'
import { handleAiSuggestions } from './ai-suggestions.ts'
import { handleEmailMessages } from './email-messages.ts'
import { handleIntegrations } from './integrations.ts'
import { createInvoiceFromQuoteRoute, handleInvoices } from './invoices.ts'
import { handleBills } from './bills.ts'
import { handleVendors } from './vendors.ts'
import { handleLeads } from './leads.ts'
import { handleMailbox, listEntityEmailMessages } from './mailbox.ts'
import { handleOrganisationConfiguration, handleOrganisations } from './organisations.ts'
import { handleProductCategories } from './product-categories.ts'
import { handleProducts } from './products.ts'
import { handleProfilePreferences } from './profile-preferences.ts'
import { handleQuotes } from './quotes.ts'
import { handleTaxRates } from './tax-rates.ts'

const corsOrigin = Deno.env.get('API_CORS_ORIGIN') ?? '*'

type MembershipRole = Database['public']['Tables']['memberships']['Row']['role']

function assertCanAccessPipeline(
  role: MembershipRole,
  method: string,
  resource: 'leads' | 'clients' | 'vendors',
): void {
  if (resource === 'leads' && role === 'billing') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members cannot access leads')
  }
  if (resource === 'clients' && role === 'billing' && method !== 'GET') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members can only read clients')
  }
  if (resource === 'vendors' && role === 'billing' && method !== 'GET') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members can only read vendors')
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
    throw new ApiError(403, 'FORBIDDEN', 'This membership cannot modify the product catalog')
  }
}

function assertCanAccessQuotes(role: MembershipRole, method: string): void {
  if (role === 'billing') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members cannot access quotes')
  }
  if (role === 'readonly' && method !== 'GET') {
    throw new ApiError(403, 'FORBIDDEN', 'Readonly members cannot modify quotes')
  }
}

function assertCanAccessInvoices(role: MembershipRole, method: string): void {
  if (role === 'billing' && method !== 'GET') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members can only read invoices')
  }
  if (role === 'readonly' && method !== 'GET') {
    throw new ApiError(403, 'FORBIDDEN', 'Readonly members cannot modify invoices')
  }
}

function assertCanAccessBills(role: MembershipRole, method: string): void {
  if (role === 'billing' && method !== 'GET') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members can only read bills')
  }
  if (role === 'readonly' && method !== 'GET') {
    throw new ApiError(403, 'FORBIDDEN', 'Readonly members cannot modify bills')
  }
}

function isHeaderlessRoute(path: string): boolean {
  return (
    path === '/api/v1/health' ||
    path === '/api/v1/organisations' ||
    path === '/api/v1/profile/preferences'
  )
}

export default {
  fetch: withSupabase(
    {
      auth: 'user',
      cors: {
        headers: {
          'Access-Control-Allow-Origin': corsOrigin,
          'Access-Control-Allow-Headers':
            'authorization, apikey, content-type, if-match, idempotency-key, x-client-info, x-org-id, x-request-id',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Expose-Headers': 'etag, location, x-request-id',
        },
      },
    },
    async (req, ctx) => {
      const suppliedRequestId = req.headers.get('x-request-id')
      const requestId = suppliedRequestId && /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedRequestId)
        ? suppliedRequestId
        : crypto.randomUUID()

      try {
        const path = apiPath(new URL(req.url).pathname)
        if (path === '/api/v1/health' && req.method === 'GET') {
          return jsonResponse({ data: { status: 'ok', api_version: 'v1' } }, 200, requestId)
        }

        const userId = ctx.userClaims?.id
        if (!userId) {
          throw new ApiError(
            401,
            'UNAUTHENTICATED',
            'Authenticated user identity is unavailable',
          )
        }

        const db = ctx.supabase as unknown as SupabaseClient<Database>

        if (path === '/api/v1/organisations') {
          return await handleOrganisations(req, db, path, userId, requestId)
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
          throw new ApiError(500, 'INTERNAL_ERROR', 'Organisation context validation failed')
        }
        if (!membership) {
          throw new ApiError(403, 'FORBIDDEN', 'No active membership for this organisation')
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
          return await handleTaxRates(req, db, path, orgId, membership.role, requestId)
        }

        const entityEmailMatch = path.match(
          /^\/api\/v1\/(contacts|leads|clients)\/([0-9a-f-]{36})\/email-messages$/i,
        )
        if (entityEmailMatch) {
          if (membership.role === 'billing') {
            throw new ApiError(403, 'FORBIDDEN', 'Billing members cannot access entity email')
          }
          if (req.method !== 'GET') {
            throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for entity email')
          }
          // Path segment is plural; stub expects singular entity type.
          const entityTypeByResource = {
            contacts: 'contact',
            leads: 'lead',
            clients: 'client',
          } as const
          const resource = entityEmailMatch[1].toLowerCase() as keyof typeof entityTypeByResource
          const entityType = entityTypeByResource[resource]
          if (!entityType) {
            throw new ApiError(404, 'NOT_FOUND', 'Route not found')
          }
          return await listEntityEmailMessages(
            db,
            orgId,
            entityType,
            entityEmailMatch[2],
            requestId,
          )
        }

        if (path === '/api/v1/contacts' || path.startsWith('/api/v1/contacts/')) {
          if (membership.role === 'billing') {
            throw new ApiError(403, 'FORBIDDEN', 'Billing members cannot access contacts')
          }
          if (membership.role === 'readonly' && req.method !== 'GET') {
            throw new ApiError(403, 'FORBIDDEN', 'Readonly members cannot modify contacts')
          }
          return await handleContacts(req, db, path, orgId, requestId)
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
          return await handleProducts(req, db, path, orgId, requestId, userId)
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
          return await handleQuotes(req, db, path, orgId, requestId)
        }

        if (path === '/api/v1/invoices' || path.startsWith('/api/v1/invoices/')) {
          assertCanAccessInvoices(membership.role, req.method)
          return await handleInvoices(req, db, path, orgId, requestId)
        }

        if (path === '/api/v1/bills' || path.startsWith('/api/v1/bills/')) {
          assertCanAccessBills(membership.role, req.method)
          return await handleBills(req, db, path, orgId, requestId)
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
  ),
}

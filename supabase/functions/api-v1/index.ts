import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from '@supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../_shared/database.ts'
import { handleClients } from './clients.ts'
import { handleContacts } from './contacts.ts'
import { ApiError, apiPath, errorResponse, jsonResponse, parseUuid } from './http.ts'
import { handleLeads } from './leads.ts'
import { handleProductCategories } from './product-categories.ts'
import { handleProducts } from './products.ts'

const corsOrigin = Deno.env.get('API_CORS_ORIGIN') ?? '*'

type MembershipRole = Database['public']['Tables']['memberships']['Row']['role']

function assertCanAccessPipeline(
  role: MembershipRole,
  method: string,
  resource: 'leads' | 'clients',
): void {
  if (resource === 'leads' && role === 'billing') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members cannot access leads')
  }
  if (resource === 'clients' && role === 'billing' && method !== 'GET') {
    throw new ApiError(403, 'FORBIDDEN', 'Billing members can only read clients')
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

export default {
  fetch: withSupabase(
    {
      auth: 'user',
      cors: {
        headers: {
          'Access-Control-Allow-Origin': corsOrigin,
          'Access-Control-Allow-Headers':
            'authorization, apikey, content-type, if-match, idempotency-key, x-client-info, x-org-id, x-request-id',
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
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

        const orgHeader = req.headers.get('x-org-id')
        if (!orgHeader) {
          throw new ApiError(
            400,
            'ORG_CONTEXT_REQUIRED',
            'X-Org-Id is required for organisation-scoped routes',
          )
        }
        const orgId = parseUuid(orgHeader, 'x-org-id')
        const userId = ctx.userClaims?.id
        if (!userId) {
          throw new ApiError(
            401,
            'UNAUTHENTICATED',
            'Authenticated user identity is unavailable',
          )
        }

        const db = ctx.supabase as unknown as SupabaseClient<Database>
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

        if (
          path === '/api/v1/product-categories' ||
          path.startsWith('/api/v1/product-categories/')
        ) {
          assertCanAccessCatalog(membership.role, req.method)
          return await handleProductCategories(req, db, path, orgId, requestId)
        }

        if (path === '/api/v1/products' || path.startsWith('/api/v1/products/')) {
          assertCanAccessCatalog(membership.role, req.method)
          return await handleProducts(req, db, path, orgId, requestId)
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

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json, MembershipRow, OrganisationRow } from '../_shared/database.ts'
import { ApiError, etag, jsonBody, jsonResponse, parseVersion } from './http.ts'

type DatabaseClient = SupabaseClient<Database>
type Theme = 'system' | 'light' | 'dark'

const THEMES = new Set<Theme>(['system', 'light', 'dark'])

const ORG_SUMMARY =
  'id,name,legal_name,slug,logo_path,default_currency,timezone,locale,country_code,theme_default,version,created_at,updated_at,deleted_at'

const ORG_CONFIG =
  'id,name,legal_name,slug,logo_path,billing_email,phone,website_url,tax_identifier,registration_number,default_currency,timezone,locale,country_code,theme_default,settings,version,created_at,updated_at,deleted_at'

function isValidTimezone(value: string): boolean {
  // V8's supportedValuesOf('timeZone') often omits the literal "UTC"
  // (preferring Etc/UTC). Accept both — create_organisation defaults to UTC.
  if (value === 'UTC' || value === 'Etc/UTC') return true
  try {
    // Deno / modern V8 expose IANA zones.
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
      .supportedValuesOf?.('timeZone')
    if (supported) return supported.includes(value)
  } catch {
    // fall through
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

export function validateOrganisationCreateBody(
  body: Record<string, unknown>,
): {
  name: string
  slug: string
  country_code: string
  default_currency: string
  timezone: string
  locale: string
} {
  const fields: Record<string, string> = {}
  const writable = new Set([
    'name',
    'slug',
    'country_code',
    'default_currency',
    'timezone',
    'locale',
  ])
  for (const key of Object.keys(body)) {
    if (!writable.has(key)) fields[key] = 'Unknown field'
  }

  const name = body.name
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 200) {
    fields.name = 'Must be a non-empty string up to 200 characters'
  }

  const slug = body.slug
  if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    fields.slug = 'Must be a lowercase kebab-case slug'
  }

  const country = body.country_code
  if (typeof country !== 'string' || !/^[A-Za-z]{2}$/.test(country)) {
    fields.country_code = 'Must be a 2-letter ISO country code'
  }

  let currency = 'GBP'
  if ('default_currency' in body) {
    const value = body.default_currency
    if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) {
      fields.default_currency = 'Must be a 3-letter uppercase ISO currency code'
    } else {
      currency = value
    }
  }

  let timezone = 'UTC'
  if ('timezone' in body) {
    const value = body.timezone
    if (typeof value !== 'string' || !value.trim() || !isValidTimezone(value.trim())) {
      fields.timezone = 'Must be a valid IANA timezone'
    } else {
      timezone = value.trim()
    }
  }

  let locale = 'en-GB'
  if ('locale' in body) {
    const value = body.locale
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 32) {
      fields.locale = 'Must be a non-empty locale string'
    } else {
      locale = value.trim()
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Organisation validation failed', fields)
  }

  return {
    name: (name as string).trim(),
    slug: slug as string,
    country_code: (country as string).toUpperCase(),
    default_currency: currency,
    timezone,
    locale,
  }
}

export function validateOrganisationConfigurationBody(
  body: Record<string, unknown>,
): Partial<{
  name: string
  legal_name: string | null
  logo_path: string | null
  billing_email: string | null
  phone: string | null
  website_url: string | null
  tax_identifier: string | null
  registration_number: string | null
  default_currency: string
  timezone: string
  locale: string
  country_code: string
  theme_default: Theme
  settings: Json
}> {
  const fields: Record<string, string> = {}
  const writable = new Set([
    'name',
    'legal_name',
    'logo_path',
    'billing_email',
    'phone',
    'website_url',
    'tax_identifier',
    'registration_number',
    'default_currency',
    'timezone',
    'locale',
    'country_code',
    'theme_default',
    'settings',
  ])
  const output: Record<string, unknown> = {}

  for (const key of Object.keys(body)) {
    if (!writable.has(key)) fields[key] = 'Unknown field'
  }
  if (Object.keys(body).length === 0) {
    fields._ = 'At least one field is required'
  }

  if ('name' in body) {
    const value = body.name
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 200) {
      fields.name = 'Must be a non-empty string up to 200 characters'
    } else {
      output.name = value.trim()
    }
  }

  for (
    const key of [
      'legal_name',
      'logo_path',
      'phone',
      'website_url',
      'tax_identifier',
      'registration_number',
    ] as const
  ) {
    if (key in body) {
      const value = body[key]
      if (value !== null && typeof value !== 'string') {
        fields[key] = 'Must be a string or null'
      } else if (typeof value === 'string' && value.trim().length > 500) {
        fields[key] = 'Must not exceed 500 characters'
      } else {
        output[key] = typeof value === 'string' ? value.trim() || null : null
      }
    }
  }

  if ('billing_email' in body) {
    const value = body.billing_email
    if (value !== null && (typeof value !== 'string' || !value.includes('@'))) {
      fields.billing_email = 'Must be an email address or null'
    } else {
      output.billing_email = typeof value === 'string' ? value.trim().toLowerCase() : null
    }
  }

  if ('default_currency' in body) {
    const value = body.default_currency
    if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) {
      fields.default_currency = 'Must be a 3-letter uppercase ISO currency code'
    } else {
      output.default_currency = value
    }
  }

  if ('timezone' in body) {
    const value = body.timezone
    if (typeof value !== 'string' || !value.trim() || !isValidTimezone(value.trim())) {
      fields.timezone = 'Must be a valid IANA timezone'
    } else {
      output.timezone = value.trim()
    }
  }

  if ('locale' in body) {
    const value = body.locale
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 32) {
      fields.locale = 'Must be a non-empty locale string'
    } else {
      output.locale = value.trim()
    }
  }

  if ('country_code' in body) {
    const value = body.country_code
    if (typeof value !== 'string' || !/^[A-Za-z]{2}$/.test(value)) {
      fields.country_code = 'Must be a 2-letter ISO country code'
    } else {
      output.country_code = value.toUpperCase()
    }
  }

  if ('theme_default' in body) {
    const value = body.theme_default
    if (typeof value !== 'string' || !THEMES.has(value as Theme)) {
      fields.theme_default = 'Must be system, light, or dark'
    } else {
      output.theme_default = value
    }
  }

  if ('settings' in body) {
    const value = body.settings
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value)
    ) {
      fields.settings = 'Must be a JSON object'
    } else {
      output.settings = value as Json
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Organisation configuration validation failed',
      fields,
    )
  }

  return output as ReturnType<typeof validateOrganisationConfigurationBody>
}

function databaseError(error: { code?: string; message?: string }, requestId: string): ApiError {
  if (error.code === '23505') {
    return new ApiError(409, 'CONFLICT', 'Organisation slug is already in use')
  }
  console.error('Organisation operation failed', {
    request_id: requestId,
    code: error.code ?? 'unknown',
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'The organisation operation failed')
}

export async function listOrganisations(
  db: DatabaseClient,
  userId: string,
  requestId: string,
): Promise<Response> {
  const { data: memberships, error } = await db
    .from('memberships')
    .select('id,org_id,role,status,joined_at,created_at,updated_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('joined_at', { ascending: true })

  if (error) throw databaseError(error, requestId)

  const rows = memberships ?? []
  if (rows.length === 0) {
    return jsonResponse({ data: [] }, 200, requestId)
  }

  const orgIds = rows.map((row) => row.org_id)
  const { data: orgs, error: orgError } = await db
    .from('organisations')
    .select(ORG_SUMMARY)
    .in('id', orgIds)
    .is('deleted_at', null)

  if (orgError) throw databaseError(orgError, requestId)

  const byId = new Map((orgs ?? []).map((org) => [org.id, org]))
  const data = rows
    .map((membership) => {
      const organisation = byId.get(membership.org_id)
      if (!organisation) return null
      return {
        membership: {
          id: membership.id,
          role: membership.role,
          status: membership.status,
          joined_at: membership.joined_at,
        },
        organisation: {
          id: organisation.id,
          name: organisation.name,
          slug: organisation.slug,
          logo_path: organisation.logo_path,
          default_currency: organisation.default_currency,
          timezone: organisation.timezone,
          locale: organisation.locale,
          country_code: organisation.country_code,
          theme_default: organisation.theme_default,
        },
      }
    })
    .filter((row) => row !== null)

  return jsonResponse({ data }, 200, requestId)
}

export async function createOrganisation(
  req: Request,
  db: DatabaseClient,
  userId: string,
  requestId: string,
): Promise<Response> {
  const payload = validateOrganisationCreateBody(await jsonBody(req))
  const { data: organisation, error } = await db.rpc('create_organisation', {
    p_name: payload.name,
    p_slug: payload.slug,
    p_country_code: payload.country_code,
    p_default_currency: payload.default_currency,
    p_timezone: payload.timezone,
    p_locale: payload.locale,
  })
  if (error) throw databaseError(error, requestId)
  if (!organisation) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Organisation creation returned no row')
  }

  const { data: membership, error: membershipError } = await db
    .from('memberships')
    .select('id,role,status,joined_at')
    .eq('org_id', organisation.id)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle()

  if (membershipError) throw databaseError(membershipError, requestId)
  if (!membership) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Owner membership was not created')
  }

  return jsonResponse(
    {
      data: {
        organisation: {
          id: organisation.id,
          name: organisation.name,
          slug: organisation.slug,
          logo_path: organisation.logo_path,
          default_currency: organisation.default_currency,
          timezone: organisation.timezone,
          locale: organisation.locale,
          country_code: organisation.country_code,
          theme_default: organisation.theme_default,
          version: organisation.version,
        },
        membership,
      },
    },
    201,
    requestId,
    {
      etag: etag(organisation.version),
      location: `/api/v1/organisation/configuration`,
    },
  )
}

export async function getOrganisationConfiguration(
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const { data, error } = await db
    .from('organisations')
    .select(ORG_CONFIG)
    .eq('id', orgId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw databaseError(error, requestId)
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Organisation not found')
  return jsonResponse({ data }, 200, requestId, { etag: etag(data.version) })
}

export async function patchOrganisationConfiguration(
  req: Request,
  db: DatabaseClient,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const { data: current, error: currentError } = await db
    .from('organisations')
    .select('id,version')
    .eq('id', orgId)
    .is('deleted_at', null)
    .maybeSingle()

  if (currentError) throw databaseError(currentError, requestId)
  if (!current) throw new ApiError(404, 'NOT_FOUND', 'Organisation not found')
  if (current.version !== version) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'Organisation version does not match If-Match')
  }

  const payload = validateOrganisationConfigurationBody(await jsonBody(req))
  const { data, error } = await db
    .from('organisations')
    .update(payload as Database['public']['Tables']['organisations']['Update'])
    .eq('id', orgId)
    .eq('version', version)
    .is('deleted_at', null)
    .select(ORG_CONFIG)
    .maybeSingle()

  if (error) throw databaseError(error, requestId)
  if (!data) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'Organisation version does not match If-Match')
  }
  return jsonResponse({ data }, 200, requestId, { etag: etag(data.version) })
}

export function handleOrganisations(
  req: Request,
  db: DatabaseClient,
  path: string,
  userId: string,
  requestId: string,
): Promise<Response> {
  if (path === '/api/v1/organisations') {
    if (req.method === 'GET') return listOrganisations(db, userId, requestId)
    if (req.method === 'POST') return createOrganisation(req, db, userId, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for organisations')
  }
  throw new ApiError(404, 'NOT_FOUND', 'Route not found')
}

export function handleOrganisationConfiguration(
  req: Request,
  db: DatabaseClient,
  path: string,
  orgId: string,
  role: MembershipRow['role'],
  requestId: string,
): Promise<Response> {
  if (path !== '/api/v1/organisation/configuration') {
    throw new ApiError(404, 'NOT_FOUND', 'Route not found')
  }
  if (req.method === 'GET') {
    if (role !== 'owner') {
      throw new ApiError(403, 'FORBIDDEN', 'Only owners can access organisation configuration')
    }
    return getOrganisationConfiguration(db, orgId, requestId)
  }
  if (req.method === 'PATCH') {
    if (role !== 'owner') {
      throw new ApiError(
        403,
        'FORBIDDEN',
        'Only owners can update organisation configuration',
      )
    }
    return patchOrganisationConfiguration(req, db, orgId, requestId)
  }
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for organisation configuration')
}

export type { OrganisationRow, Theme }

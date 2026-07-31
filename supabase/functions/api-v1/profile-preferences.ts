import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../_shared/database.ts'
import { ApiError, jsonBody, jsonResponse } from './http.ts'

type DatabaseClient = SupabaseClient<Database>
type Theme = 'system' | 'light' | 'dark'

const THEMES = new Set<Theme>(['system', 'light', 'dark'])

export function validateProfilePreferencesBody(
  body: Record<string, unknown>,
): { theme_preference: Theme | null } {
  const fields: Record<string, string> = {}
  for (const key of Object.keys(body)) {
    if (key !== 'theme_preference') fields[key] = 'Unknown field'
  }
  if (!('theme_preference' in body)) {
    fields.theme_preference = 'Required'
  } else {
    const value = body.theme_preference
    if (value !== null && (typeof value !== 'string' || !THEMES.has(value as Theme))) {
      fields.theme_preference = 'Must be system, light, dark, or null'
    }
  }
  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Profile preferences validation failed', fields)
  }
  return { theme_preference: body.theme_preference as Theme | null }
}

function databaseError(error: { code?: string }, requestId: string): ApiError {
  console.error('Profile preferences operation failed', {
    request_id: requestId,
    code: error.code ?? 'unknown',
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'The profile preferences operation failed')
}

export async function getProfilePreferences(
  db: DatabaseClient,
  userId: string,
  requestId: string,
): Promise<Response> {
  const { data, error } = await db
    .from('profiles')
    .select('id,theme_preference,locale,timezone,updated_at')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw databaseError(error, requestId)
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Profile not found')
  return jsonResponse(
    {
      data: {
        theme_preference: data.theme_preference,
        locale: data.locale,
        timezone: data.timezone,
      },
    },
    200,
    requestId,
  )
}

export async function patchProfilePreferences(
  req: Request,
  db: DatabaseClient,
  userId: string,
  requestId: string,
): Promise<Response> {
  const payload = validateProfilePreferencesBody(await jsonBody(req))
  const { data, error } = await db
    .from('profiles')
    .update({ theme_preference: payload.theme_preference })
    .eq('id', userId)
    .select('id,theme_preference,locale,timezone,updated_at')
    .maybeSingle()
  if (error) throw databaseError(error, requestId)
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Profile not found')
  return jsonResponse(
    {
      data: {
        theme_preference: data.theme_preference,
        locale: data.locale,
        timezone: data.timezone,
      },
    },
    200,
    requestId,
  )
}

export function handleProfilePreferences(
  req: Request,
  db: DatabaseClient,
  path: string,
  userId: string,
  requestId: string,
): Promise<Response> {
  if (path !== '/api/v1/profile/preferences') {
    throw new ApiError(404, 'NOT_FOUND', 'Route not found')
  }
  if (req.method === 'GET') return getProfilePreferences(db, userId, requestId)
  if (req.method === 'PATCH') return patchProfilePreferences(req, db, userId, requestId)
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for profile preferences')
}

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json, NoteColor, NoteRow } from '../_shared/database.ts'
import {
  ApiError,
  etag,
  jsonBody,
  jsonResponse,
  parseLimit,
  parseUuid,
  parseVersion,
} from './http.ts'

const NOTE_SELECT =
  'id,org_id,owner_membership_id,created_at,updated_at,created_by,updated_by,deleted_at,version,title,body,body_text,color,pinned'

/** List rows omit the Tiptap document; clients only need an excerpt there. */
const NOTE_LIST_SELECT =
  'id,org_id,owner_membership_id,created_at,updated_at,created_by,updated_by,deleted_at,version,title,body_text,color,pinned'

const WRITABLE_FIELDS = new Set(['title', 'body', 'body_text', 'color', 'pinned'])
export const NOTE_COLORS = new Set<NoteColor>([
  'yellow',
  'green',
  'blue',
  'pink',
  'purple',
  'gray',
])

const TITLE_MAX = 200
const BODY_TEXT_MAX = 100_000
const BODY_MAX_BYTES = 400_000
/** Room for a full Tiptap document plus its plain-text projection. */
export const NOTE_JSON_BODY_MAX_BYTES = 600_000
const EXCERPT_LENGTH = 280

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type DatabaseNote = SupabaseClient<Database>
type MembershipRole = Database['public']['Tables']['memberships']['Row']['role']

type NoteWritable = {
  title?: string
  body?: Json
  body_text?: string
  color?: NoteColor
  pinned?: boolean
}
type NoteCreate = NoteWritable & { title: string; color: NoteColor; pinned: boolean }
type NoteUpdate = NoteWritable

type NoteListRow = Omit<NoteRow, 'body' | 'search'>

interface NoteCursor {
  pinned: boolean
  updated_at: string
  id: string
}

interface DatabaseError {
  code?: string
  message?: string
}

export function validateNoteBody(body: Record<string, unknown>, partial: false): NoteCreate
export function validateNoteBody(body: Record<string, unknown>, partial: true): NoteUpdate
export function validateNoteBody(
  body: Record<string, unknown>,
  partial: boolean,
): NoteCreate | NoteUpdate {
  const fields: Record<string, string> = {}
  const output: NoteUpdate = {}

  for (const key of Object.keys(body)) {
    if (!WRITABLE_FIELDS.has(key)) fields[key] = 'Field is not writable'
  }

  if ('title' in body) {
    const value = body.title
    if (typeof value !== 'string' || value.length > TITLE_MAX) {
      fields.title = `Must be a string of at most ${TITLE_MAX} characters`
    } else {
      output.title = value.trim()
    }
  } else if (!partial) {
    output.title = ''
  }

  if ('body' in body) {
    const value = body.body
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      fields.body = 'Must be a JSON object'
    } else if (new TextEncoder().encode(JSON.stringify(value)).byteLength > BODY_MAX_BYTES) {
      fields.body = `Must not exceed ${BODY_MAX_BYTES} bytes`
    } else {
      output.body = value as Json
    }
  }

  if ('body_text' in body) {
    const value = body.body_text
    if (typeof value !== 'string') {
      fields.body_text = 'Must be a string'
    } else if (value.length > BODY_TEXT_MAX) {
      fields.body_text = `Must not exceed ${BODY_TEXT_MAX} characters`
    } else {
      output.body_text = value
    }
  }

  if ('color' in body) {
    const value = body.color
    if (typeof value !== 'string' || !NOTE_COLORS.has(value as NoteColor)) {
      fields.color = 'Must be yellow, green, blue, pink, purple, or gray'
    } else {
      output.color = value as NoteColor
    }
  } else if (!partial) {
    output.color = 'yellow'
  }

  if ('pinned' in body) {
    const value = body.pinned
    if (typeof value !== 'boolean') {
      fields.pinned = 'Must be a boolean'
    } else {
      output.pinned = value
    }
  } else if (!partial) {
    output.pinned = false
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Note validation failed', fields)
  }
  if (partial && Object.keys(output).length === 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'At least one writable field is required')
  }

  return output as NoteCreate | NoteUpdate
}

function encodeCursor(note: NoteCursor): string {
  return btoa(JSON.stringify({ pinned: note.pinned, updated_at: note.updated_at, id: note.id }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

export function decodeNoteCursor(value: string): NoteCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url')
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    const cursor = JSON.parse(atob(`${base64}${padding}`)) as Partial<NoteCursor>
    const updatedAt = cursor.updated_at
    const id = parseUuid(cursor.id ?? null, 'cursor')
    if (
      typeof cursor.pinned !== 'boolean' ||
      typeof updatedAt !== 'string' ||
      !ISO_TIMESTAMP.test(updatedAt) ||
      Number.isNaN(Date.parse(updatedAt))
    ) {
      throw new Error('Invalid cursor')
    }
    return { pinned: cursor.pinned, updated_at: updatedAt, id }
  } catch {
    throw new ApiError(400, 'BAD_REQUEST', 'cursor is invalid', {
      cursor: 'Must be a cursor returned by this endpoint',
    })
  }
}

function databaseError(error: DatabaseError, requestId: string): ApiError {
  const message = error.message?.toLowerCase() ?? ''
  if (message.includes('version conflict')) {
    return new ApiError(412, 'PRECONDITION_FAILED', 'Note version does not match If-Match')
  }
  if (message.includes('note owner')) {
    return new ApiError(422, 'VALIDATION_ERROR', error.message ?? 'Note owner is invalid')
  }
  if (error.code === '23503') {
    return new ApiError(422, 'VALIDATION_ERROR', 'A referenced record is invalid')
  }
  if (error.code === '23514' || error.code === '22023') {
    return new ApiError(422, 'VALIDATION_ERROR', 'The note failed a database constraint')
  }
  if (error.code === '42501') {
    return new ApiError(403, 'FORBIDDEN', 'This action is not permitted')
  }
  if (error.code === 'P0002') {
    return new ApiError(404, 'NOT_FOUND', 'Note not found')
  }
  console.error('Note database operation failed', {
    request_id: requestId,
    code: error.code ?? 'unknown',
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'The note operation failed')
}

export function noteExcerpt(bodyText: string): string {
  const collapsed = bodyText.replace(/\s+/g, ' ').trim()
  return collapsed.length > EXCERPT_LENGTH
    ? `${collapsed.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…`
    : collapsed
}

function toListItem(row: NoteListRow) {
  // `body` is not part of NOTE_LIST_SELECT, but strip it defensively so a
  // wider select can never leak the full document into list responses.
  const { body_text, ...rest } = row as NoteListRow & { body?: unknown }
  delete rest.body
  return { ...rest, excerpt: noteExcerpt(body_text) }
}

/** Sanitise free text into a websearch query; returns null when nothing searchable remains. */
export function normaliseSearchQuery(raw: string | null): string | null {
  if (raw === null) return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length > 200) {
    throw new ApiError(400, 'BAD_REQUEST', 'q is too long', {
      q: 'Must be at most 200 characters',
    })
  }
  return trimmed
}

async function listNotes(
  req: Request,
  db: DatabaseNote,
  orgId: string,
  membershipId: string,
  requestId: string,
): Promise<Response> {
  const url = new URL(req.url)
  const limit = parseLimit(url.searchParams.get('limit'))
  const q = normaliseSearchQuery(url.searchParams.get('q'))

  const pinnedRaw = url.searchParams.get('pinned')
  if (pinnedRaw !== null && pinnedRaw !== 'true' && pinnedRaw !== 'false') {
    throw new ApiError(400, 'BAD_REQUEST', 'pinned must be true or false')
  }

  let query = db
    .from('notes')
    .select(NOTE_LIST_SELECT)
    .eq('org_id', orgId)
    .eq('owner_membership_id', membershipId)
    .is('deleted_at', null)
    .order('pinned', { ascending: false })
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (pinnedRaw !== null) {
    query = query.eq('pinned', pinnedRaw === 'true')
  }
  if (q !== null) {
    query = query.textSearch('search', q, { type: 'websearch', config: 'simple' })
  }

  const cursorValue = url.searchParams.get('cursor')
  if (cursorValue) {
    const cursor = decodeNoteCursor(cursorValue)
    // Keyset on (pinned desc, updated_at desc, id desc).
    const sameGroup =
      `and(pinned.eq.${cursor.pinned},or(updated_at.lt.${cursor.updated_at},and(updated_at.eq.${cursor.updated_at},id.lt.${cursor.id})))`
    query = cursor.pinned ? query.or(`pinned.eq.false,${sameGroup}`) : query.or(sameGroup)
  }

  const { data, error } = await query
  if (error) throw databaseError(error, requestId)

  const rows = (data ?? []) as NoteListRow[]
  const hasNextPage = rows.length > limit
  const page = hasNextPage ? rows.slice(0, limit) : rows
  const last = page.at(-1)

  return jsonResponse(
    {
      data: page.map(toListItem),
      meta: {
        next_cursor: hasNextPage && last ? encodeCursor(last) : null,
      },
    },
    200,
    requestId,
  )
}

async function createNote(
  req: Request,
  db: DatabaseNote,
  orgId: string,
  membershipId: string,
  requestId: string,
): Promise<Response> {
  const payload = validateNoteBody(
    await jsonBody(req, { maxBytes: NOTE_JSON_BODY_MAX_BYTES }),
    false,
  )
  const { data, error } = await db
    .from('notes')
    .insert({ ...payload, org_id: orgId, owner_membership_id: membershipId })
    .select(NOTE_SELECT)
    .single()

  if (error) throw databaseError(error, requestId)

  return jsonResponse({ data }, 201, requestId, {
    etag: etag(data.version),
    location: `/api/v1/notes/${data.id}`,
  })
}

async function findNote(
  db: DatabaseNote,
  orgId: string,
  membershipId: string,
  noteId: string,
  requestId: string,
): Promise<Omit<NoteRow, 'search'>> {
  const { data, error } = await db
    .from('notes')
    .select(NOTE_SELECT)
    .eq('org_id', orgId)
    .eq('owner_membership_id', membershipId)
    .eq('id', noteId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw databaseError(error, requestId)
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Note not found')
  return data
}

async function getNote(
  db: DatabaseNote,
  orgId: string,
  membershipId: string,
  noteId: string,
  requestId: string,
): Promise<Response> {
  const data = await findNote(db, orgId, membershipId, noteId, requestId)
  return jsonResponse({ data }, 200, requestId, { etag: etag(data.version) })
}

async function updateNote(
  req: Request,
  db: DatabaseNote,
  orgId: string,
  membershipId: string,
  noteId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const current = await findNote(db, orgId, membershipId, noteId, requestId)
  if (current.version !== version) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'Note version does not match If-Match')
  }

  const payload = validateNoteBody(
    await jsonBody(req, { maxBytes: NOTE_JSON_BODY_MAX_BYTES }),
    true,
  )
  const { data, error } = await db
    .from('notes')
    .update(payload)
    .eq('org_id', orgId)
    .eq('owner_membership_id', membershipId)
    .eq('id', noteId)
    .eq('version', version)
    .is('deleted_at', null)
    .select(NOTE_SELECT)
    .maybeSingle()

  if (error) throw databaseError(error, requestId)
  if (!data) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'Note changed during this request')
  }

  return jsonResponse({ data }, 200, requestId, { etag: etag(data.version) })
}

async function deleteNote(
  req: Request,
  db: DatabaseNote,
  orgId: string,
  membershipId: string,
  noteId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  // Confirms ownership before the RPC so a foreign note is a clean 404.
  await findNote(db, orgId, membershipId, noteId, requestId)
  const { error } = await db.rpc('soft_delete_note', {
    p_note_id: noteId,
    p_org_id: orgId,
    p_expected_version: version,
  })

  if (error) throw databaseError(error, requestId)

  return new Response(null, {
    status: 204,
    headers: { 'x-request-id': requestId },
  })
}

export async function handleNotes(
  req: Request,
  db: DatabaseNote,
  path: string,
  orgId: string,
  _role: MembershipRole,
  membershipId: string,
  requestId: string,
): Promise<Response> {
  if (path === '/api/v1/notes') {
    if (req.method === 'GET') {
      return await listNotes(req, db, orgId, membershipId, requestId)
    }
    if (req.method === 'POST') {
      return await createNote(req, db, orgId, membershipId, requestId)
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for notes')
  }

  const itemMatch = path.match(/^\/api\/v1\/notes\/([^/]+)$/)
  if (!itemMatch || !UUID_PATTERN.test(itemMatch[1])) {
    throw new ApiError(404, 'NOT_FOUND', 'Route not found')
  }

  const noteId = itemMatch[1]
  if (req.method === 'GET') {
    return await getNote(db, orgId, membershipId, noteId, requestId)
  }
  if (req.method === 'PATCH') {
    return await updateNote(req, db, orgId, membershipId, noteId, requestId)
  }
  if (req.method === 'DELETE') {
    return await deleteNote(req, db, orgId, membershipId, noteId, requestId)
  }
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for note')
}

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json, MeetingAttendeeRow, MeetingRow } from '../_shared/database.ts'
import {
  ApiError,
  etag,
  jsonBody,
  jsonResponse,
  parseLimit,
  parseUuid,
  parseVersion,
} from './http.ts'

const MEETING_SELECT =
  'id,org_id,created_at,updated_at,created_by,updated_by,deleted_at,version,title,status,starts_at,ends_at,timezone,location,meeting_url,organiser_membership_id,related_entity_type,related_entity_id,calendar_provider,external_event_id,transcript_status,summary_status,summary,metadata'

const ATTENDEE_SELECT =
  'id,org_id,created_at,updated_at,created_by,updated_by,deleted_at,version,meeting_id,contact_id,membership_id,name,email,response_status,attended,organiser'

const WRITABLE_FIELDS = new Set([
  'title',
  'status',
  'starts_at',
  'ends_at',
  'timezone',
  'location',
  'meeting_url',
  'organiser_membership_id',
  'related_entity_type',
  'related_entity_id',
  'attendees',
  'metadata',
])

const STATUSES = new Set(['scheduled', 'in_progress', 'completed', 'cancelled'])
const RELATED_ENTITY_TYPES = new Set(['client', 'contact', 'lead', 'project'])
const RESPONSE_STATUSES = new Set(['needs_action', 'accepted', 'declined', 'tentative'])

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type DatabaseMeeting = SupabaseClient<Database>
type MembershipRole = Database['public']['Tables']['memberships']['Row']['role']
type MeetingStatus = MeetingRow['status']
type RelatedEntityType = NonNullable<MeetingRow['related_entity_type']>

type AttendeeResponseStatus = NonNullable<MeetingAttendeeRow['response_status']>

type AttendeeInput = {
  email: string
  name?: string | null
  contact_id?: string | null
  membership_id?: string | null
  organiser?: boolean
  response_status?: AttendeeResponseStatus | null
  attended?: boolean | null
}

type MeetingWritable = {
  title?: string
  status?: MeetingStatus
  starts_at?: string
  ends_at?: string
  timezone?: string
  location?: string | null
  meeting_url?: string | null
  organiser_membership_id?: string | null
  related_entity_type?: RelatedEntityType | null
  related_entity_id?: string | null
  metadata?: Json
  attendees?: AttendeeInput[]
}

type MeetingCreate = MeetingWritable & {
  title: string
  status: MeetingStatus
  starts_at: string
  ends_at: string
}

type MeetingUpdate = MeetingWritable

interface MeetingCursor {
  created_at?: string
  starts_at?: string
  id: string
}

interface DatabaseError {
  code?: string
  message?: string
}

type MeetingHost = MeetingRow & {
  related_entity_label: string | null
  attendees: MeetingAttendeeRow[]
}

function isValidTimezone(value: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value })
    return true
  } catch {
    return false
  }
}

function parseRequiredTimestamp(
  value: unknown,
  field: string,
  fields: Record<string, string>,
): string | undefined {
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) {
    fields[field] = 'Must be an ISO-8601 timestamp'
    return undefined
  }
  return value
}

function validateAttendees(
  value: unknown,
  fields: Record<string, string>,
): AttendeeInput[] | undefined {
  if (!Array.isArray(value)) {
    fields.attendees = 'Must be an array of attendee objects'
    return undefined
  }
  if (value.length > 200) {
    fields.attendees = 'Must not exceed 200 attendees'
    return undefined
  }

  const attendees: AttendeeInput[] = []
  const seenEmails = new Set<string>()

  for (let i = 0; i < value.length; i++) {
    const item = value[i]
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      fields[`attendees.${i}`] = 'Must be an object'
      continue
    }
    const row = item as Record<string, unknown>
    const emailRaw = row.email
    if (
      typeof emailRaw !== 'string' || !EMAIL_RE.test(emailRaw.trim()) ||
      emailRaw.trim().length > 320
    ) {
      fields[`attendees.${i}.email`] = 'Must be a valid email address'
      continue
    }
    const email = emailRaw.trim().toLowerCase()
    if (seenEmails.has(email)) {
      fields[`attendees.${i}.email`] = 'Duplicate email in attendees list'
      continue
    }
    seenEmails.add(email)

    const attendee: AttendeeInput = { email }

    if ('name' in row) {
      const name = row.name
      if (name !== null && typeof name !== 'string') {
        fields[`attendees.${i}.name`] = 'Must be a string or null'
      } else if (typeof name === 'string' && (name.trim().length < 1 || name.trim().length > 200)) {
        fields[`attendees.${i}.name`] = 'Must be between 1 and 200 characters when set'
      } else {
        attendee.name = typeof name === 'string' ? name.trim() : null
      }
    }

    if ('contact_id' in row) {
      if (row.contact_id === null) {
        attendee.contact_id = null
      } else {
        try {
          attendee.contact_id = parseUuid(String(row.contact_id), `attendees.${i}.contact_id`)
        } catch {
          fields[`attendees.${i}.contact_id`] = 'Must be a UUID or null'
        }
      }
    }

    if ('membership_id' in row) {
      if (row.membership_id === null) {
        attendee.membership_id = null
      } else {
        try {
          attendee.membership_id = parseUuid(
            String(row.membership_id),
            `attendees.${i}.membership_id`,
          )
        } catch {
          fields[`attendees.${i}.membership_id`] = 'Must be a UUID or null'
        }
      }
    }

    if ('organiser' in row) {
      if (typeof row.organiser !== 'boolean') {
        fields[`attendees.${i}.organiser`] = 'Must be a boolean'
      } else {
        attendee.organiser = row.organiser
      }
    } else {
      attendee.organiser = false
    }

    if ('response_status' in row) {
      const status = row.response_status
      if (status !== null && (typeof status !== 'string' || !RESPONSE_STATUSES.has(status))) {
        fields[`attendees.${i}.response_status`] =
          'Must be needs_action, accepted, declined, tentative, or null'
      } else {
        attendee.response_status = status as AttendeeResponseStatus | null
      }
    }

    if ('attended' in row) {
      const attended = row.attended
      if (attended !== null && typeof attended !== 'boolean') {
        fields[`attendees.${i}.attended`] = 'Must be a boolean or null'
      } else {
        attendee.attended = attended as boolean | null
      }
    }

    attendees.push(attendee)
  }

  return attendees
}

export function validateMeetingBody(
  body: Record<string, unknown>,
  partial: false,
): MeetingCreate
export function validateMeetingBody(
  body: Record<string, unknown>,
  partial: true,
): MeetingUpdate
export function validateMeetingBody(
  body: Record<string, unknown>,
  partial: boolean,
): MeetingCreate | MeetingUpdate {
  const fields: Record<string, string> = {}
  const output: MeetingUpdate = {}

  for (const key of Object.keys(body)) {
    if (!WRITABLE_FIELDS.has(key)) fields[key] = 'Field is not writable'
  }

  if (!partial || 'title' in body) {
    const value = body.title
    if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 200) {
      fields.title = 'Must be a string between 1 and 200 characters'
    } else {
      output.title = value.trim()
    }
  }

  if ('status' in body) {
    const value = body.status
    if (typeof value !== 'string' || !STATUSES.has(value)) {
      fields.status = 'Must be scheduled, in_progress, completed, or cancelled'
    } else {
      output.status = value as MeetingStatus
    }
  } else if (!partial) {
    output.status = 'scheduled'
  }

  if (!partial || 'starts_at' in body) {
    const starts = parseRequiredTimestamp(body.starts_at, 'starts_at', fields)
    if (starts !== undefined) output.starts_at = starts
  }

  if (!partial || 'ends_at' in body) {
    const ends = parseRequiredTimestamp(body.ends_at, 'ends_at', fields)
    if (ends !== undefined) output.ends_at = ends
  }

  if ('timezone' in body) {
    const value = body.timezone
    if (typeof value !== 'string' || !value.trim() || !isValidTimezone(value.trim())) {
      fields.timezone = 'Must be a valid IANA timezone'
    } else {
      output.timezone = value.trim()
    }
  }

  if ('location' in body) {
    const value = body.location
    if (value !== null && typeof value !== 'string') {
      fields.location = 'Must be a string or null'
    } else if (
      typeof value === 'string' && (value.trim().length < 1 || value.trim().length > 500)
    ) {
      fields.location = 'Must be between 1 and 500 characters when set'
    } else {
      output.location = typeof value === 'string' ? value.trim() : null
    }
  }

  if ('meeting_url' in body) {
    const value = body.meeting_url
    if (value !== null && typeof value !== 'string') {
      fields.meeting_url = 'Must be a string or null'
    } else if (
      typeof value === 'string' &&
      (value.trim().length < 1 || value.trim().length > 2000)
    ) {
      fields.meeting_url = 'Must be between 1 and 2000 characters when set'
    } else {
      output.meeting_url = typeof value === 'string' ? value.trim() : null
    }
  }

  if ('organiser_membership_id' in body) {
    if (body.organiser_membership_id === null) {
      output.organiser_membership_id = null
    } else {
      try {
        output.organiser_membership_id = parseUuid(
          String(body.organiser_membership_id),
          'organiser_membership_id',
        )
      } catch {
        fields.organiser_membership_id = 'Must be a UUID or null'
      }
    }
  }

  const hasRelatedType = 'related_entity_type' in body
  const hasRelatedId = 'related_entity_id' in body

  if (hasRelatedType) {
    const value = body.related_entity_type
    if (value === null) {
      output.related_entity_type = null
    } else if (typeof value !== 'string' || !RELATED_ENTITY_TYPES.has(value)) {
      fields.related_entity_type = 'Must be client, contact, lead, project, or null'
    } else {
      output.related_entity_type = value as RelatedEntityType
    }
  }

  if (hasRelatedId) {
    if (body.related_entity_id === null) {
      output.related_entity_id = null
    } else {
      try {
        output.related_entity_id = parseUuid(String(body.related_entity_id), 'related_entity_id')
      } catch {
        fields.related_entity_id = 'Must be a UUID or null'
      }
    }
  }

  if (!partial) {
    const type = output.related_entity_type ?? null
    const id = output.related_entity_id ?? null
    if ((type === null) !== (id === null)) {
      fields.related_entity_type = 'related_entity_type and related_entity_id must be set together'
      fields.related_entity_id = 'related_entity_type and related_entity_id must be set together'
    }
  } else if (hasRelatedType || hasRelatedId) {
    // Partial: clearing one requires clearing both; setting one requires the other in body.
    if (output.related_entity_type === null || output.related_entity_id === null) {
      if (
        !(hasRelatedType && hasRelatedId && body.related_entity_type === null &&
          body.related_entity_id === null)
      ) {
        if (output.related_entity_type === null && output.related_entity_id === null) {
          // both cleared — ok when both keys present as null
        } else if (
          (hasRelatedType && body.related_entity_type === null) !==
            (hasRelatedId && body.related_entity_id === null)
        ) {
          fields.related_entity_type =
            'related_entity_type and related_entity_id must be cleared together'
          fields.related_entity_id =
            'related_entity_type and related_entity_id must be cleared together'
        }
      }
    }
    if (
      (output.related_entity_type && !hasRelatedId) ||
      (output.related_entity_id && !hasRelatedType && output.related_entity_type === undefined)
    ) {
      // Allow patch that sets both; if only one of a non-null pair, error.
      if (output.related_entity_type && output.related_entity_id === undefined) {
        fields.related_entity_id = 'Must be provided with related_entity_type'
      }
      if (output.related_entity_id && output.related_entity_type === undefined) {
        fields.related_entity_type = 'Must be provided with related_entity_id'
      }
    }
  }

  if ('attendees' in body) {
    const attendees = validateAttendees(body.attendees, fields)
    if (attendees !== undefined) output.attendees = attendees
  }

  if ('metadata' in body) {
    const value = body.metadata
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      fields.metadata = 'Must be a JSON object'
    } else if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 16_384) {
      fields.metadata = 'Must not exceed 16 KiB'
    } else {
      output.metadata = value as Json
    }
  }

  const starts = output.starts_at
  const ends = output.ends_at
  if (starts && ends && Date.parse(ends) <= Date.parse(starts)) {
    fields.ends_at = 'Must be greater than starts_at'
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Meeting validation failed', fields)
  }
  if (partial && Object.keys(output).length === 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'At least one writable field is required')
  }

  return output as MeetingCreate | MeetingUpdate
}

function encodeCursor(cursor: MeetingCursor): string {
  return btoa(JSON.stringify(cursor))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

export function decodeMeetingCursor(value: string, upcoming: boolean): MeetingCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url')
    const base64 = value.replaceAll('-', '+').replaceAll('/', '_')
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    const cursor = JSON.parse(atob(`${base64}${padding}`)) as Partial<MeetingCursor>
    const id = parseUuid(cursor.id ?? null, 'cursor')
    if (upcoming) {
      const startsAt = cursor.starts_at
      if (
        typeof startsAt !== 'string' ||
        !ISO_TIMESTAMP.test(startsAt) ||
        Number.isNaN(Date.parse(startsAt))
      ) {
        throw new Error('Invalid timestamp')
      }
      return { starts_at: startsAt, id }
    }
    const createdAt = cursor.created_at
    if (
      typeof createdAt !== 'string' ||
      !ISO_TIMESTAMP.test(createdAt) ||
      Number.isNaN(Date.parse(createdAt))
    ) {
      throw new Error('Invalid timestamp')
    }
    return { created_at: createdAt, id }
  } catch {
    throw new ApiError(400, 'BAD_REQUEST', 'cursor is invalid', {
      cursor: 'Must be a cursor returned by this endpoint',
    })
  }
}

function databaseError(error: DatabaseError, requestId: string): ApiError {
  const message = error.message ?? ''
  const lower = message.toLowerCase()
  if (lower.includes('version conflict')) {
    return new ApiError(412, 'PRECONDITION_FAILED', 'Meeting version does not match If-Match')
  }
  if (
    lower.includes('organiser must be') ||
    lower.includes('related') ||
    lower.includes('attendee')
  ) {
    return new ApiError(422, 'VALIDATION_ERROR', message || 'Meeting reference is invalid')
  }
  if (error.code === '23505') {
    return new ApiError(409, 'CONFLICT', 'The meeting conflicts with an existing record')
  }
  if (error.code === '23503') {
    return new ApiError(422, 'VALIDATION_ERROR', 'A referenced record is invalid')
  }
  if (error.code === '23514' || error.code === '22023') {
    return new ApiError(
      422,
      'VALIDATION_ERROR',
      message || 'The meeting failed a database constraint',
    )
  }
  if (error.code === '42501') {
    return new ApiError(403, 'FORBIDDEN', 'This action is not permitted')
  }
  if (error.code === 'P0002') {
    return new ApiError(404, 'NOT_FOUND', 'Meeting not found')
  }
  console.error('Meeting database operation failed', {
    request_id: requestId,
    code: error.code ?? 'unknown',
  })
  return new ApiError(500, 'INTERNAL_ERROR', 'The meeting operation failed')
}

async function resolveRelatedEntityLabel(
  db: DatabaseMeeting,
  orgId: string,
  entityType: string | null,
  entityId: string | null,
): Promise<string | null> {
  if (!entityType || !entityId) return null
  if (entityType === 'client') {
    const { data } = await db
      .from('clients')
      .select('name')
      .eq('org_id', orgId)
      .eq('id', entityId)
      .is('deleted_at', null)
      .maybeSingle()
    return data?.name ?? null
  }
  if (entityType === 'contact') {
    const { data } = await db
      .from('contacts')
      .select('display_name')
      .eq('org_id', orgId)
      .eq('id', entityId)
      .is('deleted_at', null)
      .maybeSingle()
    return data?.display_name ?? null
  }
  if (entityType === 'lead') {
    const { data } = await db
      .from('leads')
      .select('name')
      .eq('org_id', orgId)
      .eq('id', entityId)
      .is('deleted_at', null)
      .maybeSingle()
    return data?.name ?? null
  }
  if (entityType === 'project') {
    const { data } = await db
      .from('projects')
      .select('name')
      .eq('org_id', orgId)
      .eq('id', entityId)
      .is('deleted_at', null)
      .maybeSingle()
    return data?.name ?? null
  }
  return null
}

async function listAttendees(
  db: DatabaseMeeting,
  orgId: string,
  meetingId: string,
  requestId: string,
): Promise<MeetingAttendeeRow[]> {
  const { data, error } = await db
    .from('meeting_attendees')
    .select(ATTENDEE_SELECT)
    .eq('org_id', orgId)
    .eq('meeting_id', meetingId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (error) throw databaseError(error, requestId)
  return data ?? []
}

async function replaceAttendees(
  db: DatabaseMeeting,
  orgId: string,
  meetingId: string,
  attendees: AttendeeInput[],
  requestId: string,
): Promise<MeetingAttendeeRow[]> {
  const payload = attendees.map((attendee) => ({
    email: attendee.email,
    name: attendee.name ?? null,
    contact_id: attendee.contact_id ?? null,
    membership_id: attendee.membership_id ?? null,
    organiser: attendee.organiser ?? false,
    response_status: attendee.response_status ?? null,
    attended: attendee.attended ?? null,
  }))

  const { data, error } = await db.rpc('replace_meeting_attendees', {
    p_meeting_id: meetingId,
    p_org_id: orgId,
    p_attendees: payload,
  })

  if (error) throw databaseError(error, requestId)
  if (!Array.isArray(data)) return []
  return data as MeetingAttendeeRow[]
}

async function hostMeeting(
  db: DatabaseMeeting,
  orgId: string,
  meeting: MeetingRow,
  requestId: string,
  attendees?: MeetingAttendeeRow[],
): Promise<MeetingHost> {
  const [related_entity_label, nested] = await Promise.all([
    resolveRelatedEntityLabel(
      db,
      orgId,
      meeting.related_entity_type,
      meeting.related_entity_id,
    ),
    attendees ? Promise.resolve(attendees) : listAttendees(db, orgId, meeting.id, requestId),
  ])
  return { ...meeting, related_entity_label, attendees: nested }
}

async function defaultOrgTimezone(
  db: DatabaseMeeting,
  orgId: string,
  requestId: string,
): Promise<string> {
  const { data, error } = await db
    .from('organisations')
    .select('timezone')
    .eq('id', orgId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw databaseError(error, requestId)
  return data?.timezone ?? 'UTC'
}

async function listMeetings(
  req: Request,
  db: DatabaseMeeting,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const url = new URL(req.url)
  const limit = parseLimit(url.searchParams.get('limit'))
  const status = url.searchParams.get('status')
  if (status && !STATUSES.has(status)) {
    throw new ApiError(400, 'BAD_REQUEST', 'status is invalid')
  }

  const upcomingRaw = url.searchParams.get('upcoming')
  const upcoming = upcomingRaw === 'true' || upcomingRaw === '1'
  if (upcomingRaw && !upcoming && upcomingRaw !== 'false' && upcomingRaw !== '0') {
    throw new ApiError(400, 'BAD_REQUEST', 'upcoming must be true or false')
  }

  let query = db
    .from('meetings')
    .select(MEETING_SELECT)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .limit(limit + 1)

  if (status) {
    query = query.eq('status', status as MeetingStatus)
  }

  if (upcoming) {
    const now = new Date().toISOString()
    query = query
      .gte('starts_at', now)
      .in('status', ['scheduled', 'in_progress'])
      .order('starts_at', { ascending: true })
      .order('id', { ascending: true })
  } else {
    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
  }

  const cursorValue = url.searchParams.get('cursor')
  if (cursorValue) {
    const cursor = decodeMeetingCursor(cursorValue, upcoming)
    if (upcoming && cursor.starts_at) {
      query = query.or(
        `starts_at.gt.${cursor.starts_at},and(starts_at.eq.${cursor.starts_at},id.gt.${cursor.id})`,
      )
    } else if (cursor.created_at) {
      query = query.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      )
    }
  }

  const { data, error } = await query
  if (error) throw databaseError(error, requestId)

  const meetings = data ?? []
  const hasNextPage = meetings.length > limit
  const page = hasNextPage ? meetings.slice(0, limit) : meetings
  const last = page.at(-1)

  let nextCursor: string | null = null
  if (hasNextPage && last) {
    nextCursor = upcoming
      ? encodeCursor({ starts_at: last.starts_at, id: last.id })
      : encodeCursor({ created_at: last.created_at, id: last.id })
  }

  return jsonResponse(
    {
      data: page,
      meta: { next_cursor: nextCursor },
    },
    200,
    requestId,
  )
}

async function createMeeting(
  req: Request,
  db: DatabaseMeeting,
  orgId: string,
  requestId: string,
): Promise<Response> {
  const body = await jsonBody(req)
  const payload = validateMeetingBody(body, false)
  const timezone = payload.timezone ?? (await defaultOrgTimezone(db, orgId, requestId))
  const { attendees, ...meetingFields } = payload

  const { data, error } = await db
    .from('meetings')
    .insert({
      ...meetingFields,
      timezone,
      org_id: orgId,
      transcript_status: 'none',
      summary_status: 'none',
    })
    .select(MEETING_SELECT)
    .single()

  if (error) throw databaseError(error, requestId)

  let nested: MeetingAttendeeRow[] = []
  if (attendees) {
    nested = await replaceAttendees(db, orgId, data.id, attendees, requestId)
  }

  const host = await hostMeeting(db, orgId, data, requestId, nested)
  return jsonResponse({ data: host }, 201, requestId, {
    etag: etag(data.version),
    location: `/api/v1/meetings/${data.id}`,
  })
}

async function findMeeting(
  db: DatabaseMeeting,
  orgId: string,
  meetingId: string,
  requestId: string,
): Promise<MeetingRow> {
  const { data, error } = await db
    .from('meetings')
    .select(MEETING_SELECT)
    .eq('org_id', orgId)
    .eq('id', meetingId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw databaseError(error, requestId)
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Meeting not found')
  return data
}

async function getMeeting(
  db: DatabaseMeeting,
  orgId: string,
  meetingId: string,
  requestId: string,
): Promise<Response> {
  const meeting = await findMeeting(db, orgId, meetingId, requestId)
  const host = await hostMeeting(db, orgId, meeting, requestId)
  return jsonResponse({ data: host }, 200, requestId, { etag: etag(meeting.version) })
}

async function updateMeeting(
  req: Request,
  db: DatabaseMeeting,
  orgId: string,
  meetingId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const current = await findMeeting(db, orgId, meetingId, requestId)
  if (current.version !== version) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'Meeting version does not match If-Match')
  }

  const payload = validateMeetingBody(await jsonBody(req), true)
  const { attendees, ...meetingFields } = payload

  // Merge schedule check when only one side is patched.
  const starts = meetingFields.starts_at ?? current.starts_at
  const ends = meetingFields.ends_at ?? current.ends_at
  if (Date.parse(ends) <= Date.parse(starts)) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Meeting validation failed', {
      ends_at: 'Must be greater than starts_at',
    })
  }

  // Merge related entity pair against current row when partially patched.
  const nextType = 'related_entity_type' in meetingFields
    ? meetingFields.related_entity_type
    : current.related_entity_type
  const nextId = 'related_entity_id' in meetingFields
    ? meetingFields.related_entity_id
    : current.related_entity_id
  if ((nextType === null) !== (nextId === null)) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Meeting validation failed', {
      related_entity_type: 'related_entity_type and related_entity_id must be set together',
      related_entity_id: 'related_entity_type and related_entity_id must be set together',
    })
  }

  let data = current
  if (Object.keys(meetingFields).length > 0) {
    const { data: updated, error } = await db
      .from('meetings')
      .update(meetingFields)
      .eq('org_id', orgId)
      .eq('id', meetingId)
      .eq('version', version)
      .is('deleted_at', null)
      .select(MEETING_SELECT)
      .maybeSingle()

    if (error) throw databaseError(error, requestId)
    if (!updated) {
      throw new ApiError(412, 'PRECONDITION_FAILED', 'Meeting changed during this request')
    }
    data = updated
  }

  let nested: MeetingAttendeeRow[] | undefined
  if (attendees !== undefined) {
    nested = await replaceAttendees(db, orgId, meetingId, attendees, requestId)
  }

  const host = await hostMeeting(db, orgId, data, requestId, nested)
  return jsonResponse({ data: host }, 200, requestId, { etag: etag(data.version) })
}

async function deleteMeeting(
  req: Request,
  db: DatabaseMeeting,
  orgId: string,
  meetingId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const { error } = await db.rpc('soft_delete_meeting', {
    p_meeting_id: meetingId,
    p_org_id: orgId,
    p_expected_version: version,
  })

  if (error) throw databaseError(error, requestId)

  return new Response(null, {
    status: 204,
    headers: { 'x-request-id': requestId },
  })
}

export function handleMeetings(
  req: Request,
  db: DatabaseMeeting,
  path: string,
  orgId: string,
  _role: MembershipRole,
  requestId: string,
): Promise<Response> {
  if (path === '/api/v1/meetings') {
    if (req.method === 'GET') return listMeetings(req, db, orgId, requestId)
    if (req.method === 'POST') return createMeeting(req, db, orgId, requestId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for meetings')
  }

  const itemMatch = path.match(
    /^\/api\/v1\/meetings\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  )
  if (!itemMatch) throw new ApiError(404, 'NOT_FOUND', 'Route not found')

  const meetingId = itemMatch[1]
  if (req.method === 'GET') return getMeeting(db, orgId, meetingId, requestId)
  if (req.method === 'PATCH') return updateMeeting(req, db, orgId, meetingId, requestId)
  if (req.method === 'DELETE') return deleteMeeting(req, db, orgId, meetingId, requestId)
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for meeting')
}

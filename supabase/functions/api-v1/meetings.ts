import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Database,
  Json,
  MeetingAttendeeRow,
  MeetingRow,
  MeetingTaskProposalRow,
  MeetingTranscriptRow,
} from '../_shared/database.ts'
import {
  ApiError,
  etag,
  jsonBody,
  jsonResponse,
  parseLimit,
  parseUuid,
  parseVersion,
} from './http.ts'
import { cancelMeetingOnGoogle, pushMeetingToGoogle } from './calendar-push.ts'

const MEETING_SELECT =
  'id,org_id,created_at,updated_at,created_by,updated_by,deleted_at,version,title,status,starts_at,ends_at,timezone,location,meeting_url,organiser_membership_id,related_entity_type,related_entity_id,calendar_provider,external_event_id,transcript_status,summary_status,summary,metadata'

const ATTENDEE_SELECT =
  'id,org_id,created_at,updated_at,created_by,updated_by,deleted_at,version,meeting_id,contact_id,membership_id,name,email,response_status,attended,organiser'

const TRANSCRIPT_SELECT =
  'id,org_id,created_at,updated_at,created_by,updated_by,deleted_at,version,meeting_id,document_id,provider,language_code,status,plain_text,segments,processed_at,error_code'

const PROPOSAL_SELECT =
  'id,org_id,created_at,updated_at,created_by,updated_by,deleted_at,version,meeting_id,title,description,suggested_assignee_membership_id,suggested_due_at,confidence,status,accepted_task_id,decided_by,decided_at'

const TRANSCRIPT_STATUSES = new Set(['uploaded', 'processing', 'ready', 'failed'])
const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'

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
  transcript: MeetingTranscriptRow | null
  task_proposals: MeetingTaskProposalRow[]
}

type TranscriptStatus = MeetingTranscriptRow['status']
type MeetingTranscriptStatus = MeetingRow['transcript_status']

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

/**
 * Decode list cursor. When `byStartsAt` is true (upcoming or starts_at range mode),
 * the cursor carries `starts_at`+`id`; otherwise `created_at`+`id`.
 */
export function decodeMeetingCursor(value: string, byStartsAt: boolean): MeetingCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url')
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    const cursor = JSON.parse(atob(`${base64}${padding}`)) as Partial<MeetingCursor>
    const id = parseUuid(cursor.id ?? null, 'cursor')
    if (byStartsAt) {
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

function parseOptionalStartsBound(value: string | null, field: string): string | null {
  if (value === null || value === '') return null
  if (!ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ApiError(400, 'BAD_REQUEST', `${field} is invalid`, {
      [field]: 'Must be an ISO-8601 timestamp',
    })
  }
  return new Date(Date.parse(value)).toISOString()
}

/** Parse optional calendar window; rejects inverted bounds and combo with upcoming. */
export function parseMeetingListRange(
  searchParams: URLSearchParams,
  upcoming: boolean,
): { startsAfter: string | null; startsBefore: string | null; rangeActive: boolean } {
  const startsAfter = parseOptionalStartsBound(searchParams.get('starts_after'), 'starts_after')
  const startsBefore = parseOptionalStartsBound(searchParams.get('starts_before'), 'starts_before')
  const rangeActive = startsAfter !== null || startsBefore !== null

  if (rangeActive && upcoming) {
    throw new ApiError(
      400,
      'BAD_REQUEST',
      'upcoming cannot be combined with starts_after or starts_before',
      {
        upcoming: 'Omit upcoming when using a starts_at range',
      },
    )
  }

  if (
    startsAfter !== null &&
    startsBefore !== null &&
    Date.parse(startsAfter) > Date.parse(startsBefore)
  ) {
    throw new ApiError(
      400,
      'BAD_REQUEST',
      'starts_after must be less than or equal to starts_before',
      {
        starts_after: 'Must be ≤ starts_before',
        starts_before: 'Must be ≥ starts_after',
      },
    )
  }

  return { startsAfter, startsBefore, rangeActive }
}

function databaseError(error: DatabaseError, requestId: string): ApiError {
  const message = error.message ?? ''
  const lower = message.toLowerCase()
  if (lower.includes('version conflict')) {
    return new ApiError(412, 'PRECONDITION_FAILED', 'Meeting version does not match If-Match')
  }
  if (lower.includes('not open for accept') || lower.includes('not open for dismiss')) {
    return new ApiError(409, 'CONFLICT', message || 'Task proposal is not open for accept')
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
  if (error.code === '22023') {
    // Deliberate RAISE from our own RPCs; the message is user-facing.
    return new ApiError(422, 'VALIDATION_ERROR', message || 'Meeting validation failed')
  }
  if (error.code === '23514') {
    // Postgres-generated constraint messages leak schema details; keep generic.
    return new ApiError(422, 'VALIDATION_ERROR', 'The meeting failed a database constraint')
  }
  if (error.code === '42501') {
    return new ApiError(403, 'FORBIDDEN', 'This action is not permitted')
  }
  if (error.code === 'P0001') {
    return new ApiError(409, 'CONFLICT', message || 'Task proposal conflict')
  }
  if (error.code === 'P0002') {
    if (lower.includes('proposal')) {
      return new ApiError(404, 'NOT_FOUND', 'Task proposal not found')
    }
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

async function listTranscript(
  db: DatabaseMeeting,
  orgId: string,
  meetingId: string,
  requestId: string,
): Promise<MeetingTranscriptRow | null> {
  const { data, error } = await db
    .from('meeting_transcripts')
    .select(TRANSCRIPT_SELECT)
    .eq('org_id', orgId)
    .eq('meeting_id', meetingId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw databaseError(error, requestId)
  return data
}

async function listTaskProposals(
  db: DatabaseMeeting,
  orgId: string,
  meetingId: string,
  requestId: string,
): Promise<MeetingTaskProposalRow[]> {
  const { data, error } = await db
    .from('meeting_task_proposals')
    .select(PROPOSAL_SELECT)
    .eq('org_id', orgId)
    .eq('meeting_id', meetingId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw databaseError(error, requestId)
  return data ?? []
}

async function hostMeeting(
  db: DatabaseMeeting,
  orgId: string,
  meeting: MeetingRow,
  requestId: string,
  attendees?: MeetingAttendeeRow[],
): Promise<MeetingHost> {
  const [related_entity_label, nested, transcript, task_proposals] = await Promise.all([
    resolveRelatedEntityLabel(
      db,
      orgId,
      meeting.related_entity_type,
      meeting.related_entity_id,
    ),
    attendees ? Promise.resolve(attendees) : listAttendees(db, orgId, meeting.id, requestId),
    listTranscript(db, orgId, meeting.id, requestId),
    listTaskProposals(db, orgId, meeting.id, requestId),
  ])
  return {
    ...meeting,
    related_entity_label,
    attendees: nested,
    transcript,
    task_proposals,
  }
}

function mapTranscriptToMeetingStatus(status: TranscriptStatus): MeetingTranscriptStatus {
  return status
}

function buildStubSummary(plainText: string): string {
  const trimmed = plainText.trim().replace(/\s+/g, ' ')
  const excerpt = trimmed.slice(0, 280)
  return `Meeting summary (stub): ${excerpt}${trimmed.length > 280 ? '…' : ''}`
}

function buildStubProposals(
  plainText: string,
): Array<{ title: string; description: string; confidence: number }> {
  const lines = plainText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const seeds = lines.length > 0
    ? lines.slice(0, 3)
    : [plainText.trim().slice(0, 80) || 'Follow up from meeting']
  return seeds.map((seed, index) => {
    const title = seed.length > 120 ? `${seed.slice(0, 117)}…` : seed
    return {
      title: title || `Follow-up ${index + 1}`,
      description: `Proposed from transcript line ${index + 1}.`,
      confidence: Number((0.9 - index * 0.1).toFixed(4)),
    }
  })
}

function assertMeetingWritable(meeting: MeetingRow, version: number): void {
  if (meeting.version !== version) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'Meeting version does not match If-Match')
  }
}

async function updateMeetingAssistantFields(
  db: DatabaseMeeting,
  orgId: string,
  meetingId: string,
  version: number,
  patch: Partial<Pick<MeetingRow, 'transcript_status' | 'summary_status' | 'summary'>>,
  requestId: string,
): Promise<MeetingRow> {
  const { data, error } = await db
    .from('meetings')
    .update(patch)
    .eq('org_id', orgId)
    .eq('id', meetingId)
    .eq('version', version)
    .is('deleted_at', null)
    .select(MEETING_SELECT)
    .maybeSingle()
  if (error) throw databaseError(error, requestId)
  if (!data) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'Meeting changed during this request')
  }
  return data
}

async function attachTranscript(
  req: Request,
  db: DatabaseMeeting,
  orgId: string,
  meetingId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const meeting = await findMeeting(db, orgId, meetingId, requestId)
  assertMeetingWritable(meeting, version)

  const body = await jsonBody(req)
  const documentIdRaw = body.document_id
  const plainTextRaw = body.plain_text
  const documentId = documentIdRaw === undefined || documentIdRaw === null
    ? null
    : parseUuid(String(documentIdRaw), 'document_id')
  const plainText = plainTextRaw === undefined || plainTextRaw === null
    ? null
    : String(plainTextRaw)
  if (plainText !== null && plainText.length > 500000) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Transcript validation failed', {
      plain_text: 'Must be at most 500000 characters',
    })
  }
  if (!documentId && (plainText === null || plainText.trim() === '')) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Transcript validation failed', {
      document_id: 'Provide document_id and/or plain_text',
      plain_text: 'Provide document_id and/or plain_text',
    })
  }

  let status: TranscriptStatus = plainText && plainText.trim() !== '' ? 'ready' : 'uploaded'
  if (body.status !== undefined && body.status !== null) {
    const statusValue = String(body.status)
    if (!TRANSCRIPT_STATUSES.has(statusValue)) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'Transcript validation failed', {
        status: 'Must be uploaded, processing, ready, or failed',
      })
    }
    status = statusValue as TranscriptStatus
  }

  if (documentId) {
    const { data: document, error: documentError } = await db
      .from('documents')
      .select('id')
      .eq('org_id', orgId)
      .eq('id', documentId)
      .is('deleted_at', null)
      .maybeSingle()
    if (documentError) throw databaseError(documentError, requestId)
    if (!document) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'Transcript validation failed', {
        document_id: 'Document not found in this organisation',
      })
    }
    const { data: link, error: linkError } = await db
      .from('document_links')
      .select('id')
      .eq('org_id', orgId)
      .eq('document_id', documentId)
      .eq('entity_type', 'meeting')
      .eq('entity_id', meetingId)
      .is('deleted_at', null)
      .maybeSingle()
    if (linkError) throw databaseError(linkError, requestId)
    if (!link) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'Transcript validation failed', {
        document_id: 'Document must be linked to this meeting',
      })
    }
  }

  const provider = body.provider === undefined || body.provider === null
    ? null
    : String(body.provider)
  const languageCode = body.language_code === undefined || body.language_code === null
    ? null
    : String(body.language_code)

  const existing = await listTranscript(db, orgId, meetingId, requestId)
  const processedAt = status === 'ready' ? new Date().toISOString() : null
  if (existing) {
    const { error } = await db
      .from('meeting_transcripts')
      .update({
        document_id: documentId,
        plain_text: plainText,
        status,
        provider,
        language_code: languageCode,
        processed_at: processedAt,
        error_code: status === 'failed' && typeof body.error_code === 'string'
          ? body.error_code
          : null,
      })
      .eq('org_id', orgId)
      .eq('id', existing.id)
      .is('deleted_at', null)
      .select(TRANSCRIPT_SELECT)
      .single()
    if (error) throw databaseError(error, requestId)
  } else {
    const { error } = await db
      .from('meeting_transcripts')
      .insert({
        org_id: orgId,
        meeting_id: meetingId,
        document_id: documentId,
        plain_text: plainText,
        status,
        provider,
        language_code: languageCode,
        processed_at: processedAt,
      })
      .select(TRANSCRIPT_SELECT)
      .single()
    if (error) throw databaseError(error, requestId)
  }

  const updatedMeeting = await updateMeetingAssistantFields(
    db,
    orgId,
    meetingId,
    version,
    { transcript_status: mapTranscriptToMeetingStatus(status) },
    requestId,
  )
  const host = await hostMeeting(db, orgId, updatedMeeting, requestId)
  return jsonResponse({ data: host }, 200, requestId, { etag: etag(updatedMeeting.version) })
}

async function generateSummary(
  req: Request,
  db: DatabaseMeeting,
  orgId: string,
  meetingId: string,
  requestId: string,
): Promise<Response> {
  const version = parseVersion(req)
  let meeting = await findMeeting(db, orgId, meetingId, requestId)
  assertMeetingWritable(meeting, version)

  const body = await jsonBody(req)
  const stubPlain = typeof body.plain_text === 'string' ? body.plain_text : null
  let transcript = await listTranscript(db, orgId, meetingId, requestId)

  if (stubPlain && stubPlain.trim() !== '') {
    // Explicit stub path: ensure a ready transcript exists from the provided text.
    const attachReq = new Request(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify({
        plain_text: stubPlain,
        status: 'ready',
        document_id: transcript?.document_id ?? null,
      }),
    })
    const attachResponse = await attachTranscript(attachReq, db, orgId, meetingId, requestId)
    if (!attachResponse.ok) return attachResponse
    const attachJson = await attachResponse.json() as { data: MeetingHost }
    meeting = attachJson.data
    transcript = attachJson.data.transcript
  }

  const plainText = transcript?.plain_text?.trim() ?? ''
  if (!transcript || transcript.status !== 'ready' || plainText === '') {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Summary generation requires a ready transcript', {
      transcript: 'Attach a ready transcript (or pass plain_text stub) before generating a summary',
    })
  }

  // Refresh version after optional stub attach.
  const currentVersion = meeting.version
  meeting = await updateMeetingAssistantFields(
    db,
    orgId,
    meetingId,
    currentVersion,
    { summary_status: 'generating' },
    requestId,
  )

  const summary = buildStubSummary(plainText)
  const proposals = buildStubProposals(plainText)

  // Replace only still-proposed rows so accepted/dismissed history is preserved.
  const { data: openProposals, error: openError } = await db
    .from('meeting_task_proposals')
    .select('id')
    .eq('org_id', orgId)
    .eq('meeting_id', meetingId)
    .eq('status', 'proposed')
    .is('deleted_at', null)
  if (openError) throw databaseError(openError, requestId)
  if ((openProposals ?? []).length > 0) {
    const { error: softError } = await db
      .from('meeting_task_proposals')
      .update({ deleted_at: new Date().toISOString() })
      .eq('org_id', orgId)
      .eq('meeting_id', meetingId)
      .eq('status', 'proposed')
      .is('deleted_at', null)
    if (softError) throw databaseError(softError, requestId)
  }

  if (proposals.length > 0) {
    const { error: insertError } = await db.from('meeting_task_proposals').insert(
      proposals.map((proposal) => ({
        org_id: orgId,
        meeting_id: meetingId,
        title: proposal.title,
        description: proposal.description,
        confidence: proposal.confidence,
        status: 'proposed' as const,
      })),
    )
    if (insertError) throw databaseError(insertError, requestId)
  }

  meeting = await updateMeetingAssistantFields(
    db,
    orgId,
    meetingId,
    meeting.version,
    { summary_status: 'ready', summary },
    requestId,
  )

  const host = await hostMeeting(db, orgId, meeting, requestId)
  return jsonResponse({ data: host }, 200, requestId, { etag: etag(meeting.version) })
}

async function findProposal(
  db: DatabaseMeeting,
  orgId: string,
  meetingId: string,
  proposalId: string,
  requestId: string,
): Promise<MeetingTaskProposalRow> {
  const { data, error } = await db
    .from('meeting_task_proposals')
    .select(PROPOSAL_SELECT)
    .eq('org_id', orgId)
    .eq('meeting_id', meetingId)
    .eq('id', proposalId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw databaseError(error, requestId)
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Task proposal not found')
  return data
}

async function acceptProposal(
  db: DatabaseMeeting,
  orgId: string,
  meetingId: string,
  proposalId: string,
  requestId: string,
  _userId: string,
): Promise<Response> {
  await findMeeting(db, orgId, meetingId, requestId)

  const { data, error } = await db.rpc('accept_meeting_task_proposal', {
    p_org_id: orgId,
    p_meeting_id: meetingId,
    p_proposal_id: proposalId,
  })
  if (error) throw databaseError(error, requestId)
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Accept proposal returned an unexpected payload')
  }
  const acceptedTaskId = (data as { accepted_task_id?: string }).accepted_task_id
  if (typeof acceptedTaskId !== 'string') {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Accept proposal returned an incomplete payload')
  }

  const meeting = await findMeeting(db, orgId, meetingId, requestId)
  const host = await hostMeeting(db, orgId, meeting, requestId)
  return jsonResponse({ data: host, meta: { accepted_task_id: acceptedTaskId } }, 200, requestId, {
    etag: etag(meeting.version),
  })
}

async function dismissProposal(
  db: DatabaseMeeting,
  orgId: string,
  meetingId: string,
  proposalId: string,
  requestId: string,
  userId: string,
): Promise<Response> {
  await findMeeting(db, orgId, meetingId, requestId)
  const proposal = await findProposal(db, orgId, meetingId, proposalId, requestId)
  if (proposal.status !== 'proposed') {
    throw new ApiError(409, 'CONFLICT', 'Task proposal is not open for dismiss')
  }

  const decidedAt = new Date().toISOString()
  const { data: updated, error } = await db
    .from('meeting_task_proposals')
    .update({
      status: 'dismissed',
      decided_at: decidedAt,
      decided_by: userId,
    })
    .eq('org_id', orgId)
    .eq('id', proposalId)
    .eq('status', 'proposed')
    .is('deleted_at', null)
    .select(PROPOSAL_SELECT)
    .maybeSingle()
  if (error) throw databaseError(error, requestId)
  if (!updated) {
    throw new ApiError(409, 'CONFLICT', 'Task proposal changed during this request')
  }

  const meeting = await findMeeting(db, orgId, meetingId, requestId)
  const host = await hostMeeting(db, orgId, meeting, requestId)
  return jsonResponse({ data: host }, 200, requestId, { etag: etag(meeting.version) })
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

  const { startsAfter, startsBefore, rangeActive } = parseMeetingListRange(
    url.searchParams,
    upcoming,
  )
  const byStartsAt = upcoming || rangeActive

  const entityType = url.searchParams.get('entity_type')
  const entityId = url.searchParams.get('entity_id')
  if ((entityType === null) !== (entityId === null)) {
    throw new ApiError(400, 'BAD_REQUEST', 'entity_type and entity_id must be provided together', {
      entity_type: 'Required with entity_id',
      entity_id: 'Required with entity_type',
    })
  }
  if (entityType !== null && !RELATED_ENTITY_TYPES.has(entityType)) {
    throw new ApiError(400, 'BAD_REQUEST', 'entity_type is invalid', {
      entity_type: 'Must be client, contact, lead, or project',
    })
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
  if (entityType !== null && entityId !== null) {
    query = query
      .eq('related_entity_type', entityType as RelatedEntityType)
      .eq('related_entity_id', parseUuid(entityId, 'entity_id'))
  }
  if (startsAfter !== null) {
    query = query.gte('starts_at', startsAfter)
  }
  if (startsBefore !== null) {
    query = query.lte('starts_at', startsBefore)
  }

  if (upcoming) {
    const now = new Date().toISOString()
    query = query
      .gte('starts_at', now)
      .in('status', ['scheduled', 'in_progress'])
  }

  if (byStartsAt) {
    query = query
      .order('starts_at', { ascending: true })
      .order('id', { ascending: true })
  } else {
    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
  }

  const cursorValue = url.searchParams.get('cursor')
  if (cursorValue) {
    const cursor = decodeMeetingCursor(cursorValue, byStartsAt)
    if (byStartsAt && cursor.starts_at) {
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
    nextCursor = byStartsAt
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
  membershipId: string,
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

  const synced = await pushMeetingToGoogle(db, orgId, membershipId, data, requestId)
  const host = await hostMeeting(db, orgId, synced, requestId, nested)
  return jsonResponse({ data: host }, 201, requestId, {
    etag: etag(synced.version),
    location: `/api/v1/meetings/${synced.id}`,
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
  membershipId: string,
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

  const synced = await pushMeetingToGoogle(db, orgId, membershipId, data, requestId)
  const host = await hostMeeting(db, orgId, synced, requestId, nested)
  return jsonResponse({ data: host }, 200, requestId, { etag: etag(synced.version) })
}

async function deleteMeeting(
  req: Request,
  db: DatabaseMeeting,
  orgId: string,
  meetingId: string,
  requestId: string,
  membershipId: string,
): Promise<Response> {
  const version = parseVersion(req)
  const current = await findMeeting(db, orgId, meetingId, requestId)
  const { error } = await db.rpc('soft_delete_meeting', {
    p_meeting_id: meetingId,
    p_org_id: orgId,
    p_expected_version: version,
  })

  if (error) throw databaseError(error, requestId)

  await cancelMeetingOnGoogle(db, orgId, membershipId, current, requestId)

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
  userId: string,
  membershipId: string,
): Promise<Response> {
  if (path === '/api/v1/meetings') {
    if (req.method === 'GET') return listMeetings(req, db, orgId, requestId)
    if (req.method === 'POST') return createMeeting(req, db, orgId, requestId, membershipId)
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for meetings')
  }

  const transcriptMatch = path.match(
    new RegExp(`^/api/v1/meetings/(${UUID_RE})/transcript$`, 'i'),
  )
  if (transcriptMatch) {
    if (req.method === 'POST') {
      return attachTranscript(req, db, orgId, transcriptMatch[1], requestId)
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for meeting transcript')
  }

  const summaryMatch = path.match(
    new RegExp(`^/api/v1/meetings/(${UUID_RE})/generate-summary$`, 'i'),
  )
  if (summaryMatch) {
    if (req.method === 'POST') {
      return generateSummary(req, db, orgId, summaryMatch[1], requestId)
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for meeting summary')
  }

  const acceptMatch = path.match(
    new RegExp(
      `^/api/v1/meetings/(${UUID_RE})/task-proposals/(${UUID_RE})/accept$`,
      'i',
    ),
  )
  if (acceptMatch) {
    if (req.method === 'POST') {
      return acceptProposal(db, orgId, acceptMatch[1], acceptMatch[2], requestId, userId)
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for proposal accept')
  }

  const dismissMatch = path.match(
    new RegExp(
      `^/api/v1/meetings/(${UUID_RE})/task-proposals/(${UUID_RE})/dismiss$`,
      'i',
    ),
  )
  if (dismissMatch) {
    if (req.method === 'POST') {
      return dismissProposal(db, orgId, dismissMatch[1], dismissMatch[2], requestId, userId)
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for proposal dismiss')
  }

  const itemMatch = path.match(new RegExp(`^/api/v1/meetings/(${UUID_RE})$`, 'i'))
  if (!itemMatch) throw new ApiError(404, 'NOT_FOUND', 'Route not found')

  const meetingId = itemMatch[1]
  if (req.method === 'GET') return getMeeting(db, orgId, meetingId, requestId)
  if (req.method === 'PATCH') {
    return updateMeeting(req, db, orgId, meetingId, requestId, membershipId)
  }
  if (req.method === 'DELETE') {
    return deleteMeeting(req, db, orgId, meetingId, requestId, membershipId)
  }
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for meeting')
}

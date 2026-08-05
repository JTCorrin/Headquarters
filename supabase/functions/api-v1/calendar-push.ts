import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  type CaldavEventInput,
  createCaldavClient,
  isCaldavSyncStubMode,
  parseCaldavSecretBlob,
} from '../_shared/caldav.ts'
import type { Database, MeetingRow } from '../_shared/database.ts'
import {
  createLiveGoogleCalendarClient,
  createStubGoogleCalendarClient,
  type GoogleEventInput,
  isCalendarSyncStubMode,
  parseTokenBlob,
  serializeTokenBlob,
} from '../_shared/google-calendar.ts'

type DatabaseClient = SupabaseClient<Database>

type ActiveConnection = {
  id: string
  provider: 'google' | 'caldav'
  calendar_id: string
  caldav_url: string | null
  account_email: string | null
  token_blob: string
}

async function loadActiveConnection(
  db: DatabaseClient,
  orgId: string,
  membershipId: string,
  preferredProvider?: string | null,
): Promise<ActiveConnection | null> {
  let query = db
    .from('calendar_connections')
    .select('id, provider, calendar_id, caldav_url, account_email, status')
    .eq('org_id', orgId)
    .eq('membership_id', membershipId)
    .eq('status', 'active')
    .is('deleted_at', null)

  if (preferredProvider === 'google' || preferredProvider === 'caldav') {
    query = query.eq('provider', preferredProvider)
  }

  const { data: row, error } = await query.maybeSingle()
  if (error || !row) return null
  if (row.provider !== 'google' && row.provider !== 'caldav') return null

  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (url && key) {
    const admin = createClient<Database>(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: creds, error: credError } = await admin.rpc(
      'read_calendar_connection_credentials',
      { p_connection_id: row.id },
    )
    if (credError || !creds || typeof creds !== 'object') return null
    const blob = (creds as { token_blob?: string | null }).token_blob
    if (!blob) return null
    return {
      id: row.id,
      provider: row.provider,
      calendar_id: row.calendar_id ?? (row.provider === 'caldav' ? 'default' : 'primary'),
      caldav_url: row.caldav_url ??
        (creds as { caldav_url?: string | null }).caldav_url ??
        null,
      account_email: row.account_email ??
        (creds as { account_email?: string | null }).account_email ??
        null,
      token_blob: blob,
    }
  }

  if (isCalendarSyncStubMode() || isCaldavSyncStubMode()) {
    return {
      id: row.id,
      provider: row.provider,
      calendar_id: row.calendar_id ?? (row.provider === 'caldav' ? 'default' : 'primary'),
      caldav_url: row.caldav_url,
      account_email: row.account_email,
      token_blob: row.provider === 'caldav'
        ? JSON.stringify({ stub: true, password: 'stub-password' })
        : serializeTokenBlob({ stub: true, refresh_token: 'stub-refresh' }),
    }
  }

  return null
}

function toGoogleEventInput(meeting: MeetingRow): GoogleEventInput {
  return {
    title: meeting.title,
    starts_at: meeting.starts_at,
    ends_at: meeting.ends_at,
    timezone: meeting.timezone,
    location: meeting.location,
    meeting_url: meeting.meeting_url,
  }
}

function toCaldavEventInput(meeting: MeetingRow, uid: string): CaldavEventInput {
  return {
    uid,
    title: meeting.title,
    starts_at: meeting.starts_at,
    ends_at: meeting.ends_at,
    timezone: meeting.timezone,
    location: meeting.location,
    meeting_url: meeting.meeting_url,
  }
}

async function persistExternalIds(
  db: DatabaseClient,
  orgId: string,
  meeting: MeetingRow,
  provider: 'google' | 'caldav',
  externalId: string,
  requestId: string,
): Promise<MeetingRow> {
  const { data: updated, error } = await db
    .from('meetings')
    .update({
      calendar_provider: provider,
      external_event_id: externalId,
    })
    .eq('org_id', orgId)
    .eq('id', meeting.id)
    .is('deleted_at', null)
    .select(
      'id,org_id,created_at,updated_at,created_by,updated_by,deleted_at,version,title,status,starts_at,ends_at,timezone,location,meeting_url,organiser_membership_id,related_entity_type,related_entity_id,calendar_provider,external_event_id,transcript_status,summary_status,summary,metadata',
    )
    .maybeSingle()

  if (error || !updated) {
    console.error('Failed to persist calendar external ids', {
      request_id: requestId,
      code: error?.code ?? 'unknown',
    })
    return meeting
  }
  return updated
}

async function pushViaGoogle(
  db: DatabaseClient,
  orgId: string,
  connection: ActiveConnection,
  meeting: MeetingRow,
  requestId: string,
): Promise<MeetingRow> {
  const blob = parseTokenBlob(connection.token_blob)
  const client = blob.stub || isCalendarSyncStubMode()
    ? createStubGoogleCalendarClient(meeting.id)
    : createLiveGoogleCalendarClient(blob, {
      onRotate: async (next) => {
        await db.rpc('upsert_calendar_connection_tokens', {
          p_org_id: orgId,
          p_token_blob: serializeTokenBlob(next),
        })
      },
    })

  const event = toGoogleEventInput(meeting)
  let externalId = meeting.external_event_id
  if (externalId) {
    await client.patchEvent(connection.calendar_id, externalId, event)
  } else {
    const created = await client.insertEvent(connection.calendar_id, event)
    externalId = created.id
  }

  const updated = await persistExternalIds(
    db,
    orgId,
    meeting,
    'google',
    externalId,
    requestId,
  )
  await db.rpc('set_calendar_connection_error', {
    p_connection_id: connection.id,
    p_error_code: null,
  })
  return updated
}

async function pushViaCaldav(
  db: DatabaseClient,
  connection: ActiveConnection,
  meeting: MeetingRow,
  requestId: string,
): Promise<MeetingRow> {
  if (!connection.caldav_url || !connection.account_email) return meeting

  const secret = parseCaldavSecretBlob(connection.token_blob)
  const password = secret.password
  if (!password && !secret.stub && !isCaldavSyncStubMode()) return meeting

  const uid = meeting.external_event_id && meeting.calendar_provider === 'caldav'
    ? meeting.external_event_id.replace(/^stub-/, '').replace(/\.ics$/, '')
    : meeting.id

  const client = await createCaldavClient({
    caldavUrl: connection.caldav_url,
    username: connection.account_email,
    password: password ?? 'stub-password',
    meetingIdForStub: meeting.id,
    forceStub: secret.stub === true,
  })

  const created = await client.putEvent(toCaldavEventInput(meeting, uid))
  const updated = await persistExternalIds(
    db,
    meeting.org_id,
    meeting,
    'caldav',
    created.id,
    requestId,
  )
  await db.rpc('set_calendar_connection_error', {
    p_connection_id: connection.id,
    p_error_code: null,
  })
  return updated
}

/**
 * Best-effort calendar push after meeting create/update.
 * Never throws — HQ CRUD must succeed even if remote calendar fails.
 * XOR: uses the membership's single active connection (google or caldav).
 */
export async function pushMeetingToCalendar(
  db: DatabaseClient,
  orgId: string,
  membershipId: string | null | undefined,
  meeting: MeetingRow,
  requestId: string,
): Promise<MeetingRow> {
  if (!membershipId) return meeting

  try {
    const preferred = meeting.calendar_provider === 'google' ||
        meeting.calendar_provider === 'caldav'
      ? meeting.calendar_provider
      : null
    const connection = await loadActiveConnection(db, orgId, membershipId, preferred)
    if (!connection) return meeting

    if (connection.provider === 'caldav') {
      return await pushViaCaldav(db, connection, meeting, requestId)
    }
    return await pushViaGoogle(db, orgId, connection, meeting, requestId)
  } catch (err) {
    console.error('Calendar push failed', {
      request_id: requestId,
      message: err instanceof Error ? err.message : 'unknown',
    })
    return meeting
  }
}

/** @deprecated alias — prefer pushMeetingToCalendar */
export const pushMeetingToGoogle = pushMeetingToCalendar

/**
 * Best-effort cancel remote event after HQ delete.
 * Clears reserved cols only when remote cancel succeeds.
 */
export async function cancelMeetingOnCalendar(
  db: DatabaseClient,
  orgId: string,
  membershipId: string | null | undefined,
  meeting: MeetingRow,
  requestId: string,
): Promise<void> {
  if (!membershipId) return
  if (!meeting.calendar_provider || !meeting.external_event_id) return

  try {
    const connection = await loadActiveConnection(
      db,
      orgId,
      membershipId,
      meeting.calendar_provider,
    )
    if (!connection) return

    if (connection.provider === 'caldav') {
      if (!connection.caldav_url || !connection.account_email) return
      const secret = parseCaldavSecretBlob(connection.token_blob)
      const client = await createCaldavClient({
        caldavUrl: connection.caldav_url,
        username: connection.account_email,
        password: secret.password ?? 'stub-password',
        meetingIdForStub: meeting.id,
        forceStub: secret.stub === true,
      })
      await client.deleteEvent(meeting.external_event_id)
    } else {
      const blob = parseTokenBlob(connection.token_blob)
      const client = blob.stub || isCalendarSyncStubMode()
        ? createStubGoogleCalendarClient(meeting.id)
        : createLiveGoogleCalendarClient(blob)
      await client.deleteEvent(connection.calendar_id, meeting.external_event_id)
    }

    await db
      .from('meetings')
      .update({
        calendar_provider: null,
        external_event_id: null,
      })
      .eq('org_id', orgId)
      .eq('id', meeting.id)

    await db.rpc('set_calendar_connection_error', {
      p_connection_id: connection.id,
      p_error_code: null,
    })
  } catch (err) {
    console.error('Calendar cancel failed', {
      request_id: requestId,
      message: err instanceof Error ? err.message : 'unknown',
    })
  }
}

/** @deprecated alias — prefer cancelMeetingOnCalendar */
export const cancelMeetingOnGoogle = cancelMeetingOnCalendar

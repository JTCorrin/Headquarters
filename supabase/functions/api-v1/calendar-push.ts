import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database, MeetingRow } from '../_shared/database.ts'
import {
  createLiveGoogleCalendarClient,
  createStubGoogleCalendarClient,
  isCalendarSyncStubMode,
  parseTokenBlob,
  serializeTokenBlob,
  type GoogleEventInput,
} from '../_shared/google-calendar.ts'

type DatabaseClient = SupabaseClient<Database>

async function loadActiveConnection(
  db: DatabaseClient,
  orgId: string,
  membershipId: string,
): Promise<{
  id: string
  calendar_id: string
  token_blob: string
} | null> {
  const { data: row, error } = await db
    .from('calendar_connections')
    .select('id, calendar_id, status')
    .eq('org_id', orgId)
    .eq('membership_id', membershipId)
    .eq('provider', 'google')
    .is('deleted_at', null)
    .maybeSingle()

  if (error || !row || row.status !== 'active') return null

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
      calendar_id: row.calendar_id ?? 'primary',
      token_blob: blob,
    }
  }

  if (isCalendarSyncStubMode()) {
    return {
      id: row.id,
      calendar_id: row.calendar_id ?? 'primary',
      token_blob: serializeTokenBlob({ stub: true, refresh_token: 'stub-refresh' }),
    }
  }

  return null
}

function toEventInput(meeting: MeetingRow): GoogleEventInput {
  return {
    title: meeting.title,
    starts_at: meeting.starts_at,
    ends_at: meeting.ends_at,
    timezone: meeting.timezone,
    location: meeting.location,
    meeting_url: meeting.meeting_url,
  }
}

/**
 * Best-effort Google push after meeting create/update.
 * Never throws — HQ CRUD must succeed even if Google fails.
 */
export async function pushMeetingToGoogle(
  db: DatabaseClient,
  orgId: string,
  membershipId: string | null | undefined,
  meeting: MeetingRow,
  requestId: string,
): Promise<MeetingRow> {
  if (!membershipId) return meeting

  try {
    const connection = await loadActiveConnection(db, orgId, membershipId)
    if (!connection) return meeting

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

    const event = toEventInput(meeting)
    let externalId = meeting.external_event_id
    if (externalId) {
      await client.patchEvent(connection.calendar_id, externalId, event)
    } else {
      const created = await client.insertEvent(connection.calendar_id, event)
      externalId = created.id
    }

    const { data: updated, error } = await db
      .from('meetings')
      .update({
        calendar_provider: 'google',
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

    await db.rpc('set_calendar_connection_error', {
      p_connection_id: connection.id,
      p_error_code: null,
    })

    return updated
  } catch (err) {
    console.error('Calendar push failed', {
      request_id: requestId,
      message: err instanceof Error ? err.message : 'unknown',
    })
    return meeting
  }
}

/**
 * Best-effort cancel remote event after HQ delete.
 * Clears reserved cols only when remote cancel succeeds.
 */
export async function cancelMeetingOnGoogle(
  db: DatabaseClient,
  orgId: string,
  membershipId: string | null | undefined,
  meeting: MeetingRow,
  requestId: string,
): Promise<void> {
  if (!membershipId) return
  if (!meeting.calendar_provider || !meeting.external_event_id) return

  try {
    const connection = await loadActiveConnection(db, orgId, membershipId)
    if (!connection) return

    const blob = parseTokenBlob(connection.token_blob)
    const client = blob.stub || isCalendarSyncStubMode()
      ? createStubGoogleCalendarClient(meeting.id)
      : createLiveGoogleCalendarClient(blob)

    await client.deleteEvent(connection.calendar_id, meeting.external_event_id)

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

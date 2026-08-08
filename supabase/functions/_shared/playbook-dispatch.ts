/**
 * Phase E: fire playbook runs from domain events (payment / invoice / cron).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from './database.ts'
import { uuidFromKey } from './playbook-actions.ts'

type Db = SupabaseClient<Database>

/** Service-role client for dispatch RPCs (not callable by authenticated JWT). */
export function playbookServiceRoleClient(): Db | null {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return null
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export type DispatchResult = {
  started: Array<Record<string, unknown>>
  skipped: Array<Record<string, unknown>>
}

function asDispatchResult(value: unknown): DispatchResult {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  return {
    started: Array.isArray(record.started)
      ? record.started.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      : [],
    skipped: Array.isArray(record.skipped)
      ? record.skipped.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      : [],
  }
}

export async function dispatchPlaybookTriggers(
  db: Db,
  input: {
    orgId: string
    triggerKind: string
    rootEntityType: string
    rootEntityId: string
    payload?: Record<string, unknown>
  },
): Promise<DispatchResult> {
  const { data, error } = await db.rpc('dispatch_playbook_triggers', {
    p_org_id: input.orgId,
    p_trigger_kind: input.triggerKind,
    p_root_entity_type: input.rootEntityType,
    p_root_entity_id: input.rootEntityId,
    p_trigger_payload: (input.payload ?? {}) as Json,
  })
  if (error) {
    console.error('dispatch_playbook_triggers failed', error)
    return { started: [], skipped: [{ error: error.message }] }
  }
  return asDispatchResult(data)
}

/** Best-effort: never fail the primary domain write. Uses service_role. */
export async function dispatchPlaybookTriggersSafe(
  input: {
    orgId: string
    triggerKind: string
    rootEntityType: string
    rootEntityId: string
    payload?: Record<string, unknown>
  },
): Promise<DispatchResult> {
  try {
    const db = playbookServiceRoleClient()
    if (!db) {
      console.error('dispatchPlaybookTriggersSafe: missing service role env')
      return { started: [], skipped: [{ error: 'SERVICE_UNAVAILABLE' }] }
    }
    return await dispatchPlaybookTriggers(db, input)
  } catch (err) {
    console.error('dispatchPlaybookTriggersSafe', err)
    return { started: [], skipped: [{ error: String(err) }] }
  }
}

export function extractEnvelopeData(envelope: {
  replay?: boolean
  response_body?: unknown
}): Record<string, unknown> | null {
  if (envelope.replay === true) return null
  const body = envelope.response_body
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const data = (body as Record<string, unknown>).data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  return data as Record<string, unknown>
}

/** Minute-bucket key for schedule.cron busy-skip (UTC or tz wall clock minute). */
export async function scheduleRootEntityId(
  playbookId: string,
  windowKey: string,
): Promise<string> {
  return await uuidFromKey(`schedule:${playbookId}:${windowKey}`)
}

/** Minimal 5-field cron match (minute hour dom month dow). Supports * and N. */
export function cronMatches(
  expr: string,
  date: Date,
  timezone = 'UTC',
): boolean {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return false

  let minute: number
  let hour: number
  let day: number
  let month: number
  let dow: number
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone.trim() || 'UTC',
      minute: 'numeric',
      hour: 'numeric',
      day: 'numeric',
      month: 'numeric',
      weekday: 'short',
      hourCycle: 'h23',
    })
    const parts = Object.fromEntries(
      fmt.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
    ) as Record<string, string>
    minute = Number(parts.minute)
    hour = Number(parts.hour)
    day = Number(parts.day)
    month = Number(parts.month)
    const map: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    }
    dow = map[parts.weekday ?? ''] ?? date.getUTCDay()
  } catch {
    minute = date.getUTCMinutes()
    hour = date.getUTCHours()
    day = date.getUTCDate()
    month = date.getUTCMonth() + 1
    dow = date.getUTCDay()
  }

  const values = [minute, hour, day, month, dow]
  return fields.every((field, i) => fieldMatches(field, values[i]!))
}

function fieldMatches(field: string, value: number): boolean {
  if (field === '*') return true
  if (/^\d+$/.test(field)) return Number(field) === value
  if (field.includes(',')) {
    return field.split(',').some((part) => fieldMatches(part.trim(), value))
  }
  const step = /^(\*|\d+)-(\d+)(?:\/(\d+))?$/.exec(field) ||
    /^\*\/(\d+)$/.exec(field)
  if (step && field.startsWith('*/')) {
    const n = Number(step[1])
    return n > 0 && value % n === 0
  }
  const range = /^(\d+)-(\d+)(?:\/(\d+))?$/.exec(field)
  if (range) {
    const start = Number(range[1])
    const end = Number(range[2])
    const incr = range[3] ? Number(range[3]) : 1
    if (value < start || value > end || incr <= 0) return false
    return (value - start) % incr === 0
  }
  return false
}

export function scheduleWindowKey(date: Date, timezone = 'UTC'): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone.trim() || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    const parts = Object.fromEntries(
      fmt.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
    ) as Record<string, string>
    return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}`
  } catch {
    return date.toISOString().slice(0, 16).replace(/[-:T]/g, '')
  }
}

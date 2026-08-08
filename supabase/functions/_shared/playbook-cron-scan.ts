/**
 * Phase E cron scanners: invoice.outstanding_days + schedule.cron.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from './database.ts'
import { cronMatches, scheduleRootEntityId, scheduleWindowKey } from './playbook-dispatch.ts'

type Db = SupabaseClient<Database>

type PlaybookRow = {
  id: string
  org_id: string
  graph_json: Json
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function triggerConfig(graph: Json, kind: string): Record<string, unknown> | null {
  const nodes = asRecord(graph).nodes
  if (!Array.isArray(nodes)) return null
  for (const raw of nodes) {
    const node = asRecord(raw)
    if (node.type !== 'trigger') continue
    const data = asRecord(node.data)
    if (data.kind === kind) return asRecord(data.config)
  }
  return null
}

function addUtcDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(Date.UTC(y!, m! - 1, d!))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

export async function scanOutstandingInvoices(
  db: Db,
  now = new Date(),
): Promise<{ dispatched: number }> {
  const today = now.toISOString().slice(0, 10)
  const { data: playbooks, error } = await db
    .from('playbooks')
    .select('id,org_id,graph_json')
    .eq('is_active', true)
    .is('deleted_at', null)

  if (error) {
    console.error('scanOutstandingInvoices list playbooks', error)
    return { dispatched: 0 }
  }

  let dispatched = 0
  for (const pb of (playbooks ?? []) as PlaybookRow[]) {
    const cfg = triggerConfig(pb.graph_json, 'invoice.outstanding_days')
    if (!cfg) continue

    const days = Number(cfg.days ?? cfg.n ?? 0)
    if (!Number.isFinite(days) || days <= 0) continue
    const basis = String(cfg.basis ?? 'due_on') === 'issue_on' ? 'issue_on' : 'due_on'
    const threshold = addUtcDays(today, -Math.floor(days))

    const { data: invoices, error: invErr } = await db
      .from('invoices')
      .select('id,org_id,status,due_on,issue_on')
      .eq('org_id', pb.org_id)
      .is('deleted_at', null)
      .in('status', ['sent', 'partial'])
      .lte(basis, threshold)
      .limit(50)
    if (invErr) {
      console.error('scanOutstandingInvoices invoices', invErr)
      continue
    }

    for (const inv of invoices ?? []) {
      const { data: run, error: startErr } = await db.rpc('start_playbook_run', {
        p_org_id: pb.org_id,
        p_playbook_id: pb.id,
        p_trigger_kind: 'invoice.outstanding_days',
        p_root_entity_type: 'invoice',
        p_root_entity_id: inv.id,
        p_trigger_payload: {
          invoice_id: inv.id,
          days,
          basis,
          threshold,
        } as Json,
        p_require_active: true,
      })
      if (startErr) {
        console.error('start outstanding run', startErr)
        continue
      }
      const status = asRecord(run).status
      if (status && status !== 'skipped_busy') dispatched += 1
    }
  }

  return { dispatched }
}

export async function scanScheduleCron(
  db: Db,
  now = new Date(),
): Promise<{ dispatched: number }> {
  const { data: playbooks, error } = await db
    .from('playbooks')
    .select('id,org_id,graph_json')
    .eq('is_active', true)
    .is('deleted_at', null)

  if (error) {
    console.error('scanScheduleCron list playbooks', error)
    return { dispatched: 0 }
  }

  let dispatched = 0
  for (const pb of (playbooks ?? []) as PlaybookRow[]) {
    const cfg = triggerConfig(pb.graph_json, 'schedule.cron')
    if (!cfg) continue
    const expr = String(cfg.cron ?? cfg.expression ?? '').trim()
    if (!expr) continue
    const timezone = String(cfg.timezone ?? 'UTC')
    if (!cronMatches(expr, now, timezone)) continue

    const windowKey = scheduleWindowKey(now, timezone)
    const rootId = await scheduleRootEntityId(pb.id, windowKey)
    const { data: run, error: startErr } = await db.rpc('start_playbook_run', {
      p_org_id: pb.org_id,
      p_playbook_id: pb.id,
      p_trigger_kind: 'schedule.cron',
      p_root_entity_type: 'schedule',
      p_root_entity_id: rootId,
      p_trigger_payload: {
        cron: expr,
        timezone,
        window_key: windowKey,
        fired_at: now.toISOString(),
      } as Json,
      p_require_active: true,
    })
    if (startErr) {
      console.error('start schedule run', startErr)
      continue
    }
    const status = asRecord(run).status
    if (status && status !== 'skipped_busy') dispatched += 1
  }

  return { dispatched }
}

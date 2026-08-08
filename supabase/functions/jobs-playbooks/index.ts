/**
 * Edge cron entry for due playbook runs + Phase E trigger scanners.
 * Header: x-playbooks-cron-secret = PLAYBOOKS_CRON_SECRET
 */
import { createClient } from '@supabase/supabase-js'
import type { Database, Json } from '../_shared/database.ts'
import type { PlaybookActionContext } from '../_shared/playbook-actions.ts'
import { scanOutstandingInvoices, scanScheduleCron } from '../_shared/playbook-cron-scan.ts'
import {
  asLoopState,
  continueLoopAfterBody,
  executeNode,
  type GraphSnapshot,
  type TickResult,
} from '../_shared/playbook-runtime.ts'

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const bufA = encoder.encode(a)
  const bufB = encoder.encode(b)
  if (bufA.byteLength !== bufB.byteLength) return false
  let diff = 0
  for (let i = 0; i < bufA.byteLength; i++) diff |= bufA[i]! ^ bufB[i]!
  return diff === 0
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }), { status: 405 })
  }

  const expectedSecret = Deno.env.get('PLAYBOOKS_CRON_SECRET')
  if (!expectedSecret) {
    console.error('PLAYBOOKS_CRON_SECRET is not configured; refusing to run')
    return new Response(JSON.stringify({ error: 'SERVICE_UNAVAILABLE' }), { status: 503 })
  }
  const suppliedSecret = req.headers.get('x-playbooks-cron-secret') ?? ''
  if (!timingSafeEqual(suppliedSecret, expectedSecret)) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401 })
  }

  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    return new Response(JSON.stringify({ error: 'SERVICE_UNAVAILABLE' }), { status: 500 })
  }

  const service = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const outstanding = await scanOutstandingInvoices(service)
  const schedules = await scanScheduleCron(service)

  const { data: claimed, error: claimError } = await service.rpc('claim_due_playbook_runs', {
    p_limit: 20,
  })
  if (claimError) {
    console.error('claim_due_playbook_runs failed', claimError)
    return new Response(JSON.stringify({ error: 'CLAIM_FAILED' }), { status: 500 })
  }

  const runs = (claimed ?? []) as Array<Record<string, unknown>>
  const results: Array<{ run_id: string; status: string }> = []

  for (const run of runs) {
    const runId = String(run.id)
    const orgId = String(run.org_id)
    const nodeId = run.current_node_id ? String(run.current_node_id) : ''
    const graph = run.graph_snapshot as GraphSnapshot
    // Keep DB root_entity_* as the trigger subject (unique busy-skip key).
    // Loop iterations override ctx.root* in memory via context.loop.
    const persistedRootType = typeof run.root_entity_type === 'string' ? run.root_entity_type : null
    const persistedRootId = typeof run.root_entity_id === 'string' ? run.root_entity_id : null
    const ctx: PlaybookActionContext = {
      db: service,
      orgId,
      runId,
      playbookVersion: Number(run.playbook_version ?? 1),
      rootEntityType: persistedRootType,
      rootEntityId: persistedRootId,
      context: asRecord(run.context),
      triggerPayload: asRecord(run.trigger_payload),
    }
    const resumeLoop = asLoopState(ctx.context)
    if (resumeLoop && resumeLoop.ids[resumeLoop.index]) {
      ctx.rootEntityType = 'contact'
      ctx.rootEntityId = resumeLoop.ids[resumeLoop.index]!
    }

    if (!nodeId) {
      await service
        .from('playbook_runs')
        .update({ status: 'completed', next_action_at: null, updated_at: new Date().toISOString() })
        .eq('id', runId)
        .eq('org_id', orgId)
      results.push({ run_id: runId, status: 'completed' })
      continue
    }

    let current = nodeId
    let finalStatus = 'running'
    for (let i = 0; i < 25; i++) {
      let tick: TickResult = await executeNode(graph, current, ctx)

      await service.from('playbook_run_steps').insert({
        org_id: orgId,
        run_id: runId,
        node_id: current,
        node_type: graph.nodes.find((n) => n.id === current)?.type ?? 'unknown',
        status: tick.kind === 'failed' ? 'failed' : 'completed',
        finished_at: new Date().toISOString(),
        result: (tick.kind === 'failed' ? {} : tick.stepResult) as Json,
        error: tick.kind === 'failed' ? tick.error : null,
      })

      if (tick.kind === 'advance' && !tick.terminal) {
        const loopNext = continueLoopAfterBody(ctx, tick.nextNodeId)
        if (loopNext) {
          tick = loopNext
          if (loopNext.kind === 'advance') {
            await service.from('playbook_run_steps').insert({
              org_id: orgId,
              run_id: runId,
              node_id: current,
              node_type: 'loopRelated',
              status: 'completed',
              finished_at: new Date().toISOString(),
              result: loopNext.stepResult as Json,
              error: null,
            })
          }
        }
      }

      if (tick.context) {
        ctx.context = tick.context
      }

      if (tick.kind === 'failed') {
        await service
          .from('playbook_runs')
          .update({
            status: 'failed',
            last_error: tick.error,
            next_action_at: null,
            context: ctx.context as Json,
            updated_at: new Date().toISOString(),
          })
          .eq('id', runId)
          .eq('org_id', orgId)
        finalStatus = 'failed'
        break
      }

      if (tick.kind === 'waiting') {
        const resume = tick.nextNodeId || null
        await service
          .from('playbook_runs')
          .update({
            status: 'waiting',
            current_node_id: resume,
            next_action_at: tick.nextActionAt.toISOString(),
            context: ctx.context as Json,
            updated_at: new Date().toISOString(),
          })
          .eq('id', runId)
          .eq('org_id', orgId)
        finalStatus = 'waiting'
        break
      }

      if (tick.terminal || !tick.nextNodeId) {
        await service
          .from('playbook_runs')
          .update({
            status: 'completed',
            current_node_id: null,
            next_action_at: null,
            context: ctx.context as Json,
            updated_at: new Date().toISOString(),
          })
          .eq('id', runId)
          .eq('org_id', orgId)
        finalStatus = 'completed'
        break
      }

      current = tick.nextNodeId
      await service
        .from('playbook_runs')
        .update({
          current_node_id: current,
          status: 'running',
          context: ctx.context as Json,
          updated_at: new Date().toISOString(),
        })
        .eq('id', runId)
        .eq('org_id', orgId)
    }

    // Step budget exhausted: re-queue so claim_due can resume (avoid stuck running).
    if (finalStatus === 'running') {
      await service
        .from('playbook_runs')
        .update({
          status: 'scheduled',
          current_node_id: current,
          next_action_at: new Date().toISOString(),
          context: ctx.context as Json,
          updated_at: new Date().toISOString(),
        })
        .eq('id', runId)
        .eq('org_id', orgId)
      finalStatus = 'scheduled'
    }

    results.push({ run_id: runId, status: finalStatus })
  }

  return new Response(
    JSON.stringify({
      data: {
        outstanding_dispatched: outstanding.dispatched,
        schedule_dispatched: schedules.dispatched,
        processed: results.length,
        results,
      },
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  )
})

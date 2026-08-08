/**
 * Edge cron entry for due playbook runs (wait / waitUntil resume).
 * Header: x-playbooks-cron-secret = PLAYBOOKS_CRON_SECRET
 */
import { createClient } from '@supabase/supabase-js'
import { executeNode, type GraphSnapshot } from '../_shared/playbook-runtime.ts'

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const bufA = encoder.encode(a)
  const bufB = encoder.encode(b)
  if (bufA.byteLength !== bufB.byteLength) return false
  let diff = 0
  for (let i = 0; i < bufA.byteLength; i++) diff |= bufA[i]! ^ bufB[i]!
  return diff === 0
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

  const service = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

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

    if (!nodeId) {
      await service
        .from('playbook_runs')
        .update({ status: 'completed', next_action_at: null, updated_at: new Date().toISOString() })
        .eq('id', runId)
        .eq('org_id', orgId)
      results.push({ run_id: runId, status: 'completed' })
      continue
    }

    // Process up to 25 nodes per tick to clear stub chains; stop on wait/terminal/fail.
    let current = nodeId
    let finalStatus = 'running'
    for (let i = 0; i < 25; i++) {
      const tick = executeNode(graph, current)
      const node = graph.nodes.find((n) => n.id === current)

      await service.from('playbook_run_steps').insert({
        org_id: orgId,
        run_id: runId,
        node_id: current,
        node_type: node?.type ?? 'unknown',
        status: tick.kind === 'failed' ? 'failed' : 'completed',
        finished_at: new Date().toISOString(),
        result: tick.kind === 'failed' ? {} : tick.stepResult,
        error: tick.kind === 'failed' ? tick.error : null,
      })

      if (tick.kind === 'failed') {
        await service
          .from('playbook_runs')
          .update({
            status: 'failed',
            last_error: tick.error,
            next_action_at: null,
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
            status: resume ? 'waiting' : 'waiting',
            current_node_id: resume,
            next_action_at: tick.nextActionAt.toISOString(),
            updated_at: new Date().toISOString(),
            // If no resume node, complete when wait elapses via empty current on next claim.
            ...(resume ? {} : {
              // Terminal wait: mark completed after delay by setting current null + waiting
              // next claim with null current completes — use completed immediately if no next.
            }),
          })
          .eq('id', runId)
          .eq('org_id', orgId)

        if (!resume) {
          // No successor after wait — complete when due by storing scheduled completion.
          await service
            .from('playbook_runs')
            .update({
              status: 'waiting',
              current_node_id: null,
              next_action_at: tick.nextActionAt.toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', runId)
            .eq('org_id', orgId)
        }
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
          updated_at: new Date().toISOString(),
        })
        .eq('id', runId)
        .eq('org_id', orgId)
    }

    results.push({ run_id: runId, status: finalStatus })
  }

  return new Response(JSON.stringify({ data: { processed: results.length, results } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
})

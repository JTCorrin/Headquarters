import { assertEquals } from 'jsr:@std/assert@1'
import {
  cronMatches,
  extractEnvelopeData,
  scheduleWindowKey,
} from '../_shared/playbook-dispatch.ts'
import {
  asLoopState,
  continueLoopAfterBody,
  type GraphSnapshot,
  outEdges,
} from '../_shared/playbook-runtime.ts'
import type { PlaybookActionContext } from '../_shared/playbook-actions.ts'

Deno.test('cronMatches supports exact minute/hour', () => {
  const date = new Date('2026-08-08T13:30:00.000Z')
  assertEquals(cronMatches('30 13 * * *', date, 'UTC'), true)
  assertEquals(cronMatches('0 13 * * *', date, 'UTC'), false)
  assertEquals(cronMatches('30 * * * *', date, 'UTC'), true)
})

Deno.test('scheduleWindowKey is stable per minute', () => {
  const a = scheduleWindowKey(new Date('2026-08-08T13:30:10.000Z'), 'UTC')
  const b = scheduleWindowKey(new Date('2026-08-08T13:30:59.000Z'), 'UTC')
  assertEquals(a, b)
  assertEquals(a.includes('202608081330'), true)
})

Deno.test('extractEnvelopeData skips replays', () => {
  assertEquals(extractEnvelopeData({ replay: true, response_body: { data: { id: 'x' } } }), null)
  assertEquals(
    extractEnvelopeData({
      replay: false,
      response_body: { data: { id: 'pay-1', direction: 'inbound' } },
    })
      ?.id,
    'pay-1',
  )
})

Deno.test('outEdges sorts by target then id', () => {
  const graph: GraphSnapshot = {
    nodes: [],
    edges: [
      { id: 'e2', source: 'loop', target: 'exit' },
      { id: 'e1', source: 'loop', target: 'body' },
    ],
  }
  const outs = outEdges(graph, 'loop')
  assertEquals(outs[0]?.target, 'body')
  assertEquals(outs[1]?.target, 'exit')
})

Deno.test('continueLoopAfterBody advances contacts then exits', () => {
  const ctx = {
    db: {} as PlaybookActionContext['db'],
    orgId: 'org',
    runId: 'run',
    playbookVersion: 1,
    rootEntityType: 'contact',
    rootEntityId: 'c1',
    context: {
      loop: {
        node_id: 'loop',
        relation: 'client.contacts',
        ids: ['c1', 'c2'],
        index: 0,
        body_entry: 'body',
        exit_node: 'exit',
        parent_entity_type: 'client',
        parent_entity_id: 'client-1',
      },
    },
    triggerPayload: {},
  } satisfies PlaybookActionContext

  const mid = continueLoopAfterBody(ctx, 'body-next')
  assertEquals(mid, null)

  const next = continueLoopAfterBody(ctx, 'exit')
  assertEquals(next?.kind, 'advance')
  if (next?.kind === 'advance') {
    assertEquals(next.nextNodeId, 'body')
    assertEquals(ctx.rootEntityId, 'c2')
    assertEquals(asLoopState(ctx.context)?.index, 1)
  }

  const done = continueLoopAfterBody(ctx, null)
  assertEquals(done?.kind, 'advance')
  if (done?.kind === 'advance') {
    assertEquals(done.nextNodeId, 'exit')
    assertEquals(asLoopState(ctx.context), null)
  }
})

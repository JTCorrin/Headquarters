/**
 * Deno-side playbook graph validation (mirrors src/lib/playbook/playbook-graph.ts).
 * Keep structural rules in sync with the Svelte Zod schema.
 */

const TRIGGER_KINDS = new Set([
  'email.received',
  'invoice.outstanding_days',
  'payment.received',
  'invoice.sent',
  'schedule.cron',
  'manual.run',
])

const NODE_TYPES = new Set([
  'trigger',
  'wait',
  'waitUntil',
  'emailSend',
  'taskCreate',
  'timelineNote',
  'notificationCreate',
  'playbookStop',
  'loopRelated',
])

export type PlaybookGraphJson = {
  nodes: Array<{
    id: string
    type: string
    position?: { x: number; y: number }
    data?: Record<string, unknown>
  }>
  edges: Array<{ id: string; source: string; target: string }>
}

export type PlaybookGraphValidation =
  | { ok: true; graph: PlaybookGraphJson }
  | { ok: false; errors: string[] }

export function defaultPlaybookGraphJson(): PlaybookGraphJson {
  return {
    nodes: [
      {
        id: crypto.randomUUID(),
        type: 'trigger',
        position: { x: 80, y: 120 },
        data: { kind: 'manual.run', config: {} },
      },
    ],
    edges: [],
  }
}

export function validatePlaybookGraphJson(input: unknown): PlaybookGraphValidation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['graph_json must be an object'] }
  }
  const raw = input as Record<string, unknown>
  if (!Array.isArray(raw.nodes) || raw.nodes.length < 1) {
    return { ok: false, errors: ['Graph must contain at least one node'] }
  }
  if (!Array.isArray(raw.edges)) {
    return { ok: false, errors: ['edges must be an array'] }
  }

  const errors: string[] = []
  const nodes: PlaybookGraphJson['nodes'] = []
  for (const [i, n] of raw.nodes.entries()) {
    if (!n || typeof n !== 'object' || Array.isArray(n)) {
      errors.push(`nodes[${i}]: invalid`)
      continue
    }
    const node = n as Record<string, unknown>
    if (typeof node.id !== 'string' || !node.id) {
      errors.push(`nodes[${i}].id: required`)
    }
    if (typeof node.type !== 'string' || !NODE_TYPES.has(node.type)) {
      errors.push(`nodes[${i}].type: invalid`)
    }
    if (node.type === 'trigger') {
      const data = node.data as Record<string, unknown> | undefined
      const kind = data?.kind
      if (typeof kind !== 'string' || !TRIGGER_KINDS.has(kind)) {
        errors.push(`nodes[${i}].data.kind: invalid trigger kind`)
      }
    }
    nodes.push({
      id: String(node.id ?? ''),
      type: String(node.type ?? ''),
      position: node.position && typeof node.position === 'object'
        ? {
          x: Number((node.position as { x?: unknown }).x ?? 0),
          y: Number((node.position as { y?: unknown }).y ?? 0),
        }
        : { x: 0, y: 0 },
      data: (node.data as Record<string, unknown>) ?? {},
    })
  }

  const edges: PlaybookGraphJson['edges'] = []
  for (const [i, e] of raw.edges.entries()) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      errors.push(`edges[${i}]: invalid`)
      continue
    }
    const edge = e as Record<string, unknown>
    if (typeof edge.id !== 'string' || !edge.id) errors.push(`edges[${i}].id: required`)
    if (typeof edge.source !== 'string' || !edge.source) {
      errors.push(`edges[${i}].source: required`)
    }
    if (typeof edge.target !== 'string' || !edge.target) {
      errors.push(`edges[${i}].target: required`)
    }
    edges.push({
      id: String(edge.id ?? ''),
      source: String(edge.source ?? ''),
      target: String(edge.target ?? ''),
    })
  }

  if (errors.length > 0) return { ok: false, errors }

  const triggers = nodes.filter((n) => n.type === 'trigger')
  if (triggers.length !== 1) {
    return {
      ok: false,
      errors: [
        triggers.length === 0
          ? 'Playbook must have exactly one trigger node.'
          : 'Playbook must have exactly one trigger node (found multiple).',
      ],
    }
  }

  const nodeIds = new Set(nodes.map((n) => n.id))
  for (const e of edges) {
    if (e.source === e.target) {
      errors.push(`Edge ${e.id}: self-loops are not allowed.`)
    }
    if (!nodeIds.has(e.source)) {
      errors.push(`Edge ${e.id}: unknown source node "${e.source}".`)
    }
    if (!nodeIds.has(e.target)) {
      errors.push(`Edge ${e.id}: unknown target node "${e.target}".`)
    }
  }
  if (errors.length > 0) return { ok: false, errors }

  const adj = new Map<string, string[]>()
  for (const id of nodeIds) adj.set(id, [])
  for (const e of edges) adj.get(e.source)!.push(e.target)

  if (hasCycle(nodeIds, adj)) {
    return { ok: false, errors: ['Playbook graph contains a cycle (must be a DAG).'] }
  }

  const reachable = collectReachable(triggers[0]!.id, adj)
  if (reachable.size !== nodeIds.size) {
    const missing = [...nodeIds].filter((id) => !reachable.has(id))
    return {
      ok: false,
      errors: [
        `All nodes must be reachable from the trigger. Unreachable: ${missing.join(', ')}.`,
      ],
    }
  }

  const outDegree = new Map<string, number>()
  for (const id of nodeIds) outDegree.set(id, 0)
  for (const e of edges) outDegree.set(e.source, (outDegree.get(e.source) ?? 0) + 1)
  const terminals = [...reachable].filter((id) => (outDegree.get(id) ?? 0) === 0)
  if (terminals.length < 1) {
    return {
      ok: false,
      errors: ['Playbook must have at least one terminal node (no outgoing edges).'],
    }
  }

  return { ok: true, graph: { nodes, edges } }
}

function collectReachable(start: string, adj: Map<string, string[]>): Set<string> {
  const seen = new Set<string>()
  const stack = [start]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    for (const t of adj.get(id) ?? []) {
      if (!seen.has(t)) stack.push(t)
    }
  }
  return seen
}

function hasCycle(nodeIds: Set<string>, adj: Map<string, string[]>): boolean {
  const state = new Map<string, 0 | 1 | 2>()
  for (const id of nodeIds) state.set(id, 0)

  function visit(u: string): boolean {
    const s = state.get(u)
    if (s === 1) return true
    if (s === 2) return false
    state.set(u, 1)
    for (const v of adj.get(u) ?? []) {
      if (visit(v)) return true
    }
    state.set(u, 2)
    return false
  }

  for (const id of nodeIds) {
    if (visit(id)) return true
  }
  return false
}

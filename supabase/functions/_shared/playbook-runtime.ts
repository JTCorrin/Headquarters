/**
 * Playbook run interpreter: wait / waitUntil / stop / loopRelated + side effects.
 */
import {
  executeSideEffect,
  isSideEffectNodeType,
  type PlaybookActionContext,
} from './playbook-actions.ts'

export type GraphNode = {
  id: string
  type: string
  data?: Record<string, unknown>
}

export type GraphEdge = { id: string; source: string; target: string }

export type GraphSnapshot = { nodes: GraphNode[]; edges: GraphEdge[] }

export type LoopState = {
  node_id: string
  relation: string
  ids: string[]
  index: number
  body_entry: string
  exit_node: string | null
  parent_entity_type: string
  parent_entity_id: string
}

export type TickResult =
  | {
    kind: 'waiting'
    nextNodeId: string
    nextActionAt: Date
    stepResult: Record<string, unknown>
    context?: Record<string, unknown>
  }
  | {
    kind: 'advance'
    nextNodeId: string | null
    terminal: boolean
    stepResult: Record<string, unknown>
    context?: Record<string, unknown>
  }
  | { kind: 'failed'; error: string }

export function getNode(graph: GraphSnapshot, nodeId: string): GraphNode | undefined {
  return graph.nodes.find((n) => n.id === nodeId)
}

export function outEdges(graph: GraphSnapshot, currentId: string): GraphEdge[] {
  return graph.edges
    .filter((e) => e.source === currentId)
    .sort((a, b) =>
      a.target === b.target ? a.id.localeCompare(b.id) : a.target.localeCompare(b.target)
    )
}

export function nextNodeId(graph: GraphSnapshot, currentId: string): string | null {
  return outEdges(graph, currentId)[0]?.target ?? null
}

export function asLoopState(context: Record<string, unknown> | undefined): LoopState | null {
  const raw = context?.loop
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const loop = raw as Record<string, unknown>
  if (typeof loop.node_id !== 'string' || typeof loop.body_entry !== 'string') return null
  if (!Array.isArray(loop.ids)) return null
  return {
    node_id: loop.node_id,
    relation: String(loop.relation ?? 'client.contacts'),
    ids: loop.ids.filter((id): id is string => typeof id === 'string'),
    index: Number(loop.index ?? 0),
    body_entry: loop.body_entry,
    exit_node: typeof loop.exit_node === 'string' ? loop.exit_node : null,
    parent_entity_type: String(loop.parent_entity_type ?? ''),
    parent_entity_id: String(loop.parent_entity_id ?? ''),
  }
}

/** After a body step, either re-enter body for next contact or exit the loop. */
export function continueLoopAfterBody(
  ctx: PlaybookActionContext,
  nextNodeIdValue: string | null,
): TickResult | null {
  const loop = asLoopState(ctx.context)
  if (!loop) return null
  const finishedIteration = nextNodeIdValue === null || nextNodeIdValue === loop.exit_node
  if (!finishedIteration) return null

  const nextIndex = loop.index + 1
  if (nextIndex < loop.ids.length) {
    const nextId = loop.ids[nextIndex]!
    const nextLoop: LoopState = { ...loop, index: nextIndex }
    ctx.context = { ...ctx.context, loop: nextLoop }
    ctx.rootEntityType = 'contact'
    ctx.rootEntityId = nextId
    return {
      kind: 'advance',
      nextNodeId: loop.body_entry,
      terminal: false,
      stepResult: {
        loop_advance: true,
        index: nextIndex,
        contact_id: nextId,
      },
      context: ctx.context,
    }
  }

  const { loop: _drop, ...rest } = ctx.context
  ctx.context = rest
  ctx.rootEntityType = loop.parent_entity_type || ctx.rootEntityType
  ctx.rootEntityId = loop.parent_entity_id || ctx.rootEntityId
  if (!loop.exit_node) {
    return {
      kind: 'advance',
      nextNodeId: null,
      terminal: true,
      stepResult: { loop_done: true, iterated: loop.ids.length },
      context: ctx.context,
    }
  }
  return {
    kind: 'advance',
    nextNodeId: loop.exit_node,
    terminal: false,
    stepResult: { loop_done: true, iterated: loop.ids.length },
    context: ctx.context,
  }
}

export function waitDurationMs(data: Record<string, unknown> | undefined): number {
  const duration = Number(data?.duration)
  const unit = String(data?.unit ?? '')
  if (!Number.isFinite(duration) || duration <= 0) return 0
  if (unit === 'minutes') return duration * 60_000
  if (unit === 'hours') return duration * 3_600_000
  if (unit === 'days') return duration * 86_400_000
  return 0
}

/** Next occurrence of HH:mm in timezone (or UTC if empty/invalid). */
export function waitUntilNextDate(
  time: string,
  timezone: string,
  now = new Date(),
): Date | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  const tz = timezone?.trim() || 'UTC'

  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    const parts = Object.fromEntries(
      fmt.formatToParts(now).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
    ) as Record<string, string>
    const y = Number(parts.year)
    const mo = Number(parts.month)
    const d = Number(parts.day)
    const curH = Number(parts.hour)
    const curM = Number(parts.minute)

    let dayOffset = 0
    if (curH > hour || (curH === hour && curM >= minute)) dayOffset = 1

    const guess = new Date(Date.UTC(y, mo - 1, d + dayOffset, hour, minute, 0))
    for (let i = 0; i < 3; i++) {
      const local = Object.fromEntries(
        fmt.formatToParts(guess).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
      ) as Record<string, string>
      const localAsUtc = Date.UTC(
        Number(local.year),
        Number(local.month) - 1,
        Number(local.day),
        Number(local.hour),
        Number(local.minute),
        Number(local.second),
      )
      const desiredAsUtc = Date.UTC(y, mo - 1, d + dayOffset, hour, minute, 0)
      guess.setTime(guess.getTime() + (desiredAsUtc - localAsUtc))
    }
    return guess
  } catch {
    return null
  }
}

function advanceResult(
  graph: GraphSnapshot,
  nodeId: string,
  stepResult: Record<string, unknown>,
): TickResult {
  const next = nextNodeId(graph, nodeId)
  if (!next) {
    return { kind: 'advance', nextNodeId: null, terminal: true, stepResult }
  }
  return { kind: 'advance', nextNodeId: next, terminal: false, stepResult }
}

export async function executeNode(
  graph: GraphSnapshot,
  nodeId: string,
  ctx: PlaybookActionContext | null = null,
  now = new Date(),
): Promise<TickResult> {
  const node = getNode(graph, nodeId)
  if (!node) return { kind: 'failed', error: `Node ${nodeId} missing from graph snapshot` }

  const data = (node.data ?? {}) as Record<string, unknown>

  if (node.type === 'wait') {
    const ms = waitDurationMs(data)
    if (ms <= 0) return { kind: 'failed', error: 'Invalid wait duration' }
    const next = nextNodeId(graph, nodeId)
    return {
      kind: 'waiting',
      nextNodeId: next ?? '',
      nextActionAt: new Date(now.getTime() + ms),
      stepResult: { waited_ms: ms, resume_node_id: next },
    }
  }

  if (node.type === 'waitUntil') {
    const when = waitUntilNextDate(String(data.time ?? ''), String(data.timezone ?? ''), now)
    if (!when) return { kind: 'failed', error: 'Invalid waitUntil time' }
    const next = nextNodeId(graph, nodeId)
    return {
      kind: 'waiting',
      nextNodeId: next ?? '',
      nextActionAt: when,
      stepResult: {
        wait_until: when.toISOString(),
        resume_node_id: next,
        mode: 'waitUntil',
      },
    }
  }

  if (node.type === 'playbookStop') {
    return {
      kind: 'advance',
      nextNodeId: null,
      terminal: true,
      stepResult: { reason: data.reason ?? '', stopped: true },
    }
  }

  if (node.type === 'loopRelated') {
    if (!ctx) {
      return advanceResult(graph, nodeId, { stub: true, node_type: node.type })
    }
    const relation = String(data.relation ?? 'client.contacts')
    if (relation !== 'client.contacts') {
      return { kind: 'failed', error: `Unsupported loop relation: ${relation}` }
    }

    const outs = outEdges(graph, nodeId)
    const bodyEntry = outs[0]?.target ?? null
    const exitNode = outs[1]?.target ?? null
    if (!bodyEntry) {
      return advanceResult(graph, nodeId, {
        loop_skipped: true,
        reason: 'no_body_edge',
      })
    }

    let clientId: string | null = null
    if (ctx.rootEntityType === 'client' && ctx.rootEntityId) {
      clientId = ctx.rootEntityId
    } else if (ctx.rootEntityType === 'invoice' && ctx.rootEntityId) {
      const { data: inv } = await ctx.db
        .from('invoices')
        .select('client_id')
        .eq('org_id', ctx.orgId)
        .eq('id', ctx.rootEntityId)
        .maybeSingle()
      clientId = typeof inv?.client_id === 'string' ? inv.client_id : null
    } else if (ctx.rootEntityType === 'payment' && ctx.rootEntityId) {
      const { data: pay } = await ctx.db
        .from('payments')
        .select('client_id')
        .eq('org_id', ctx.orgId)
        .eq('id', ctx.rootEntityId)
        .maybeSingle()
      clientId = typeof pay?.client_id === 'string' ? pay.client_id : null
    }

    if (!clientId) {
      return {
        kind: 'failed',
        error: 'loopRelated requires a client (or invoice/payment with client)',
      }
    }

    const { data: ids, error } = await ctx.db.rpc('list_playbook_client_contact_ids', {
      p_org_id: ctx.orgId,
      p_client_id: clientId,
    })
    if (error) return { kind: 'failed', error: error.message }
    const contactIds = Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === 'string')
      : []

    if (contactIds.length === 0) {
      if (!exitNode) {
        return {
          kind: 'advance',
          nextNodeId: null,
          terminal: true,
          stepResult: { loop_empty: true, relation },
          context: ctx.context,
        }
      }
      return {
        kind: 'advance',
        nextNodeId: exitNode,
        terminal: false,
        stepResult: { loop_empty: true, relation },
        context: ctx.context,
      }
    }

    const loop: LoopState = {
      node_id: nodeId,
      relation,
      ids: contactIds,
      index: 0,
      body_entry: bodyEntry,
      exit_node: exitNode,
      parent_entity_type: ctx.rootEntityType ?? 'client',
      parent_entity_id: ctx.rootEntityId ?? clientId,
    }
    ctx.context = { ...ctx.context, loop }
    ctx.rootEntityType = 'contact'
    ctx.rootEntityId = contactIds[0]!
    return {
      kind: 'advance',
      nextNodeId: bodyEntry,
      terminal: false,
      stepResult: {
        loop_started: true,
        relation,
        count: contactIds.length,
        contact_id: contactIds[0],
      },
      context: ctx.context,
    }
  }

  if (isSideEffectNodeType(node.type)) {
    if (!ctx) {
      return advanceResult(graph, nodeId, { stub: true, node_type: node.type })
    }
    const effect = await executeSideEffect(node, ctx)
    if (!effect.ok) return { kind: 'failed', error: effect.error }
    const advanced = advanceResult(graph, nodeId, effect.result)
    return advanced.kind === 'advance' ? { ...advanced, context: ctx.context } : advanced
  }

  // Unknown / trigger nodes: advance.
  const advanced = advanceResult(graph, nodeId, { stub: true, node_type: node.type })
  return ctx && advanced.kind === 'advance' ? { ...advanced, context: ctx.context } : advanced
}

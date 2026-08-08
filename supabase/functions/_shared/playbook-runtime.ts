/**
 * Minimal playbook run interpreter (Phase C): wait / waitUntil / stop + stub advance.
 */

export type GraphNode = {
  id: string
  type: string
  data?: Record<string, unknown>
}

export type GraphEdge = { id: string; source: string; target: string }

export type GraphSnapshot = { nodes: GraphNode[]; edges: GraphEdge[] }

export type TickResult =
  | { kind: 'waiting'; nextNodeId: string; nextActionAt: Date; stepResult: Record<string, unknown> }
  | {
    kind: 'advance'
    nextNodeId: string | null
    terminal: boolean
    stepResult: Record<string, unknown>
  }
  | { kind: 'failed'; error: string }

export function getNode(graph: GraphSnapshot, nodeId: string): GraphNode | undefined {
  return graph.nodes.find((n) => n.id === nodeId)
}

export function nextNodeId(graph: GraphSnapshot, currentId: string): string | null {
  const outs = graph.edges
    .filter((e) => e.source === currentId)
    .sort((a, b) =>
      a.target === b.target ? a.id.localeCompare(b.id) : a.target.localeCompare(b.target)
    )
  return outs[0]?.target ?? null
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

    // Build a UTC instant that corresponds to local y-mo-d hour:minute in tz via iterative probe.
    const guess = new Date(Date.UTC(y, mo - 1, d + dayOffset, hour, minute, 0))
    // Adjust by difference between desired local and actual local at guess.
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

export function executeNode(
  graph: GraphSnapshot,
  nodeId: string,
  now = new Date(),
): TickResult {
  const node = getNode(graph, nodeId)
  if (!node) return { kind: 'failed', error: `Node ${nodeId} missing from graph snapshot` }

  const data = (node.data ?? {}) as Record<string, unknown>

  if (node.type === 'wait') {
    const ms = waitDurationMs(data)
    if (ms <= 0) return { kind: 'failed', error: 'Invalid wait duration' }
    const next = nextNodeId(graph, nodeId)
    // After the delay, cron resumes at `next` (or completes if null).
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

  // Phase C stubs: side-effect nodes advance without doing work yet.
  const next = nextNodeId(graph, nodeId)
  if (!next) {
    return {
      kind: 'advance',
      nextNodeId: null,
      terminal: true,
      stepResult: { stub: true, node_type: node.type },
    }
  }
  return {
    kind: 'advance',
    nextNodeId: next,
    terminal: false,
    stepResult: { stub: true, node_type: node.type },
  }
}

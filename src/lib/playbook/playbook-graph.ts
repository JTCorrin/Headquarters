import type { ZodError } from 'zod';
import { playbookGraphSchema, type PlaybookGraph } from '$lib/schemas/playbook-graph.js';

export type PlaybookGraphValidationResult =
	| { ok: true; graph: PlaybookGraph }
	| { ok: false; errors: string[]; zodError?: ZodError };

/** Default canvas: single manual.run trigger. */
export function createDefaultPlaybookGraph(): PlaybookGraph {
	return {
		nodes: [
			{
				id: crypto.randomUUID(),
				type: 'trigger',
				position: { x: 80, y: 120 },
				data: { kind: 'manual.run', config: {} }
			}
		],
		edges: []
	};
}

/**
 * Zod shape + structural rules (chasers parity):
 * — exactly one trigger
 * — edges reference existing nodes, no self-loops
 * — DAG
 * — every node reachable from the trigger
 * — at least one terminal node
 */
export function validatePlaybookGraph(input: unknown): PlaybookGraphValidationResult {
	const parsed = playbookGraphSchema.safeParse(input);
	if (!parsed.success) {
		return {
			ok: false,
			errors: parsed.error.issues.map((i) => i.message || `${i.path.join('.')}: invalid`),
			zodError: parsed.error
		};
	}
	return validatePlaybookStructure(parsed.data);
}

function validatePlaybookStructure(graph: PlaybookGraph): PlaybookGraphValidationResult {
	const errors: string[] = [];
	const triggers = graph.nodes.filter((n) => n.type === 'trigger');
	if (triggers.length !== 1) {
		errors.push(
			triggers.length === 0
				? 'Playbook must have exactly one trigger node.'
				: 'Playbook must have exactly one trigger node (found multiple).'
		);
	}

	const nodeIds = new Set(graph.nodes.map((n) => n.id));
	for (const e of graph.edges) {
		if (e.source === e.target) {
			errors.push(`Edge ${e.id}: self-loops are not allowed.`);
		}
		if (!nodeIds.has(e.source)) {
			errors.push(`Edge ${e.id}: unknown source node "${e.source}".`);
		}
		if (!nodeIds.has(e.target)) {
			errors.push(`Edge ${e.id}: unknown target node "${e.target}".`);
		}
	}

	if (errors.length > 0) {
		return { ok: false, errors };
	}

	const adj = new Map<string, string[]>();
	for (const id of nodeIds) {
		adj.set(id, []);
	}
	for (const e of graph.edges) {
		adj.get(e.source)!.push(e.target);
	}

	if (hasCycle(nodeIds, adj)) {
		return { ok: false, errors: ['Playbook graph contains a cycle (must be a DAG).'] };
	}

	const triggerId = triggers[0]!.id;
	const reachable = collectReachable(triggerId, adj);
	if (reachable.size !== nodeIds.size) {
		const missing = [...nodeIds].filter((id) => !reachable.has(id));
		errors.push(
			`All nodes must be reachable from the trigger. Unreachable: ${missing.join(', ')}.`
		);
	}

	const outDegree = new Map<string, number>();
	for (const id of nodeIds) {
		outDegree.set(id, 0);
	}
	for (const e of graph.edges) {
		outDegree.set(e.source, (outDegree.get(e.source) ?? 0) + 1);
	}

	const terminals = [...reachable].filter((id) => (outDegree.get(id) ?? 0) === 0);
	if (terminals.length < 1) {
		errors.push('Playbook must have at least one terminal node (no outgoing edges).');
	}

	if (errors.length > 0) {
		return { ok: false, errors };
	}
	return { ok: true, graph };
}

function collectReachable(start: string, adj: Map<string, string[]>): Set<string> {
	const seen = new Set<string>();
	const stack = [start];
	while (stack.length > 0) {
		const id = stack.pop()!;
		if (seen.has(id)) continue;
		seen.add(id);
		for (const t of adj.get(id) ?? []) {
			if (!seen.has(t)) stack.push(t);
		}
	}
	return seen;
}

function hasCycle(nodeIds: Set<string>, adj: Map<string, string[]>): boolean {
	const state = new Map<string, 0 | 1 | 2>();
	for (const id of nodeIds) {
		state.set(id, 0);
	}

	function visit(u: string): boolean {
		const s = state.get(u);
		if (s === 1) return true;
		if (s === 2) return false;
		state.set(u, 1);
		for (const v of adj.get(u) ?? []) {
			if (visit(v)) return true;
		}
		state.set(u, 2);
		return false;
	}

	for (const id of nodeIds) {
		if (visit(id)) return true;
	}
	return false;
}

export function toPersistedPlaybookGraph(graph: PlaybookGraph): PlaybookGraph {
	return {
		nodes: graph.nodes.map((n) => ({
			id: n.id,
			type: n.type,
			position: { x: n.position.x, y: n.position.y },
			data: { ...n.data }
		})) as PlaybookGraph['nodes'],
		edges: graph.edges.map((e) => ({
			id: e.id,
			source: e.source,
			target: e.target
		}))
	};
}

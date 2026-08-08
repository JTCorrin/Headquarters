import type { Edge, Node } from '@xyflow/svelte';
import type { PlaybookGraph, PlaybookGraphNode } from '$lib/schemas/playbook-graph.js';
import { createDefaultPlaybookGraph } from './playbook-graph.js';

export function playbookGraphToFlow(graph: PlaybookGraph): { nodes: Node[]; edges: Edge[] } {
	return {
		nodes: graph.nodes.map((n) => ({
			id: n.id,
			type: n.type,
			position: { ...n.position },
			data: { ...n.data }
		})),
		edges: graph.edges.map((e) => ({
			id: e.id,
			source: e.source,
			target: e.target
		}))
	};
}

export function flowToPlaybookGraph(nodes: Node[], edges: Edge[]): unknown {
	return {
		nodes: nodes.map((n) => ({
			id: n.id,
			type: n.type,
			position: { x: n.position.x, y: n.position.y },
			data: { ...(n.data as Record<string, unknown>) }
		})),
		edges: edges.map((e) => ({
			id: e.id,
			source: e.source,
			target: e.target
		}))
	};
}

export function flowFromUnknownGraph(raw: unknown): { nodes: Node[]; edges: Edge[] } {
	if (raw && typeof raw === 'object' && Array.isArray((raw as PlaybookGraph).nodes)) {
		return playbookGraphToFlow(raw as PlaybookGraph);
	}
	return playbookGraphToFlow(createDefaultPlaybookGraph());
}

export type AddableNodeKind = Exclude<PlaybookGraphNode['type'], 'trigger'>;

export function defaultDataForNodeType(type: AddableNodeKind): Record<string, unknown> {
	switch (type) {
		case 'wait':
			return { duration: 1, unit: 'days' };
		case 'waitUntil':
			return { time: '13:00', timezone: '' };
		case 'emailSend':
			return { templateId: '', mailboxId: '', to: 'entity_primary' };
		case 'taskCreate':
			return {
				title: '',
				description: '',
				assigneeMembershipId: '',
				priority: 'p3',
				dueOffsetDays: 0
			};
		case 'timelineNote':
			return { kind: 'note', body: '' };
		case 'notificationCreate':
			return { title: '', body: '', recipientMembershipIds: [] };
		case 'playbookStop':
			return { reason: '' };
		case 'loopRelated':
			return { relation: 'client.contacts' };
	}
}

export const ADDABLE_NODE_LABELS: { type: AddableNodeKind; label: string }[] = [
	{ type: 'wait', label: 'Wait' },
	{ type: 'waitUntil', label: 'Wait until' },
	{ type: 'emailSend', label: 'Send email' },
	{ type: 'taskCreate', label: 'Create task' },
	{ type: 'timelineNote', label: 'Timeline note' },
	{ type: 'notificationCreate', label: 'Notify' },
	{ type: 'loopRelated', label: 'Loop related' },
	{ type: 'playbookStop', label: 'Stop' }
];

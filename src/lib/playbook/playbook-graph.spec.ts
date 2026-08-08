import { describe, expect, it } from 'vitest';
import {
	createDefaultPlaybookGraph,
	validatePlaybookGraph
} from './playbook-graph.js';
import type { PlaybookGraph } from '$lib/schemas/playbook-graph.js';

function trigger(id: string, x = 0, y = 0): PlaybookGraph['nodes'][number] {
	return {
		id,
		type: 'trigger',
		position: { x, y },
		data: { kind: 'manual.run', config: {} }
	};
}

describe('validatePlaybookGraph', () => {
	it('accepts default single-trigger graph', () => {
		const r = validatePlaybookGraph(createDefaultPlaybookGraph());
		expect(r.ok).toBe(true);
	});

	it('accepts minimal single-trigger graph', () => {
		const r = validatePlaybookGraph({ nodes: [trigger('t1')], edges: [] });
		expect(r.ok).toBe(true);
	});

	it('rejects zero nodes', () => {
		const r = validatePlaybookGraph({ nodes: [], edges: [] });
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.errors.some((e) => /at least one node/i.test(e))).toBe(true);
		}
	});

	it('rejects multiple triggers', () => {
		const r = validatePlaybookGraph({
			nodes: [trigger('a'), trigger('b', 100)],
			edges: []
		});
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.errors.join(' ')).toMatch(/exactly one trigger/i);
		}
	});

	it('detects cycles', () => {
		const g: PlaybookGraph = {
			nodes: [
				trigger('a'),
				{
					id: 'b',
					type: 'wait',
					position: { x: 200, y: 0 },
					data: { duration: 1, unit: 'hours' }
				},
				{
					id: 'c',
					type: 'wait',
					position: { x: 400, y: 0 },
					data: { duration: 2, unit: 'hours' }
				}
			],
			edges: [
				{ id: 'e1', source: 'a', target: 'b' },
				{ id: 'e2', source: 'b', target: 'c' },
				{ id: 'e3', source: 'c', target: 'a' }
			]
		};
		const r = validatePlaybookGraph(g);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.errors.join(' ')).toMatch(/cycle/i);
		}
	});

	it('rejects unreachable nodes', () => {
		const r = validatePlaybookGraph({
			nodes: [
				trigger('a'),
				{
					id: 'orphan',
					type: 'playbookStop',
					position: { x: 0, y: 200 },
					data: { reason: '' }
				}
			],
			edges: []
		});
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.errors.join(' ')).toMatch(/unreachable/i);
		}
	});

	it('accepts trigger → wait → stop', () => {
		const r = validatePlaybookGraph({
			nodes: [
				trigger('t'),
				{
					id: 'w',
					type: 'wait',
					position: { x: 200, y: 0 },
					data: { duration: 1, unit: 'days' }
				},
				{
					id: 's',
					type: 'playbookStop',
					position: { x: 400, y: 0 },
					data: { reason: 'done' }
				}
			],
			edges: [
				{ id: 'e1', source: 't', target: 'w' },
				{ id: 'e2', source: 'w', target: 's' }
			]
		});
		expect(r.ok).toBe(true);
	});
});

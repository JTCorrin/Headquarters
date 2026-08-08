import { describe, expect, it } from 'vitest';
import { createDefaultPlaybookGraph, validatePlaybookGraph } from './playbook-graph.js';
import { flowToPlaybookGraph, playbookGraphToFlow } from './playbook-flow.js';

describe('playbook flow round-trip', () => {
	it('round-trips default graph through flow nodes', () => {
		const graph = createDefaultPlaybookGraph();
		const flow = playbookGraphToFlow(graph);
		const raw = flowToPlaybookGraph(flow.nodes, flow.edges);
		const validated = validatePlaybookGraph(raw);
		expect(validated.ok).toBe(true);
		if (validated.ok) {
			expect(validated.graph.nodes).toHaveLength(1);
			expect(validated.graph.nodes[0]?.type).toBe('trigger');
		}
	});
});

import { describe, expect, it } from 'vitest';
import { buildReorderMove, buildStageMove } from './lead-board-moves.js';

const leads = [
	{ id: 'a', stage: 'new' as const, position: 0 },
	{ id: 'b', stage: 'new' as const, position: 1000 },
	{ id: 'c', stage: 'new' as const, position: 2000 },
	{ id: 'd', stage: 'qualified' as const, position: 0 },
	{ id: 'w', stage: 'won' as const, position: 0 }
];

describe('lead board keyboard moves', () => {
	it('moves a card to another writable stage at the end', () => {
		const move = buildStageMove(leads, 'b', 'qualified');
		expect(move).toMatchObject({
			id: 'b',
			stage: 'qualified',
			beforeId: null
		});
		expect(move!.position).toBeGreaterThan(0);
	});

	it('rejects Won as a keyboard stage target and source', () => {
		expect(buildStageMove(leads, 'b', 'won')).toBeNull();
		expect(buildStageMove(leads, 'w', 'new')).toBeNull();
		expect(buildReorderMove(leads, 'w', 'up')).toBeNull();
	});

	it('reorders within a stage', () => {
		const up = buildReorderMove(leads, 'b', 'up');
		expect(up).toMatchObject({ id: 'b', stage: 'new', beforeId: 'a' });
		expect(up!.position).toBeLessThan(0);

		const down = buildReorderMove(leads, 'b', 'down');
		expect(down).toMatchObject({ id: 'b', stage: 'new', beforeId: null });
		expect(down!.position).toBeGreaterThan(2000);
	});

	it('returns null at column edges', () => {
		expect(buildReorderMove(leads, 'a', 'up')).toBeNull();
		expect(buildReorderMove(leads, 'c', 'down')).toBeNull();
	});
});

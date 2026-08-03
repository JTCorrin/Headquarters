import { describe, expect, it } from 'vitest';
import { isTaskDueBeforeToday, toDashboardTask } from './mappers.js';
import type { TaskListItem } from '$lib/schemas/task.js';

function sampleItem(overrides: Partial<TaskListItem> = {}): TaskListItem {
	return {
		id: 't1',
		title: 'Chase invoice',
		relatedTo: 'client',
		owner: 'Me',
		status: 'Open',
		priority: 'P1 — Urgent',
		dueOn: '2026-03-10',
		version: 1,
		assigneeMembershipId: 'm1',
		rawStatus: 'open',
		rawPriority: 'p1',
		description: '',
		dueAt: '2026-03-10T00:00:00.000Z',
		position: 0,
		...overrides
	};
}

describe('dashboard task mappers', () => {
	it('maps list items into panel tasks', () => {
		expect(toDashboardTask(sampleItem())).toEqual({
			id: 't1',
			title: 'Chase invoice',
			relatedTo: 'client',
			dueOn: '2026-03-10',
			status: 'Open',
			priority: 'p1'
		});
		expect(toDashboardTask(sampleItem({ relatedTo: '—', dueOn: '—' }))).toMatchObject({
			relatedTo: undefined,
			dueOn: '—'
		});
	});

	it('detects overdue due dates against UTC today', () => {
		const now = new Date('2026-03-15T12:00:00.000Z');
		expect(isTaskDueBeforeToday('2026-03-10T00:00:00.000Z', now)).toBe(true);
		expect(isTaskDueBeforeToday('2026-03-15T00:00:00.000Z', now)).toBe(false);
		expect(isTaskDueBeforeToday(null, now)).toBe(false);
	});
});

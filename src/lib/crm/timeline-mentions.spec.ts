import { describe, expect, it } from 'vitest';
import {
	dedupeMentions,
	filterMentionCandidates,
	insertMentionAtQuery,
	parseActiveMentionQuery,
	pruneMentionsByBody
} from './timeline-mentions.js';

describe('timeline-mentions helpers', () => {
	it('parses an active @query before the caret', () => {
		expect(parseActiveMentionQuery('Hi @Ad', 6)).toEqual({ start: 3, query: 'Ad' });
		expect(parseActiveMentionQuery('Hi @Ada please', 8)).toBeNull();
		expect(parseActiveMentionQuery('no mention', 4)).toBeNull();
	});

	it('inserts a mention token and advances the caret', () => {
		expect(insertMentionAtQuery('Hi @Ad', 6, 3, 'Ada Lovelace')).toEqual({
			text: 'Hi @Ada Lovelace ',
			caret: 17
		});
	});

	it('prunes mentions whose token left the body', () => {
		const mentions = [
			{ membership_id: 'm1', display_name: 'Ada' },
			{ membership_id: 'm2', display_name: 'Grace' }
		];
		expect(pruneMentionsByBody('Ping @Ada', mentions)).toEqual([
			{ membership_id: 'm1', display_name: 'Ada' }
		]);
	});

	it('dedupes by membership_id', () => {
		expect(
			dedupeMentions([
				{ membership_id: 'm1', display_name: 'Ada' },
				{ membership_id: 'm1', display_name: 'Ada' },
				{ membership_id: 'm2', display_name: 'Grace' }
			])
		).toHaveLength(2);
	});

	it('filters candidates by display name', () => {
		const members = [
			{ display_name: 'Ada Lovelace' },
			{ display_name: 'Grace Hopper' }
		];
		expect(filterMentionCandidates(members, 'hop')).toEqual([
			{ display_name: 'Grace Hopper' }
		]);
	});
});

import { describe, expect, it } from 'vitest';
import {
	looksLikeVendorId,
	parseMeetingEntityFilter,
	parseTaskEntityFilter
} from './entity-list-filter.js';

const ID = '11111111-1111-4111-8111-111111111111';

describe('parseTaskEntityFilter', () => {
	it('returns paired filter when type and id are valid', () => {
		const params = new URLSearchParams({ entity_type: 'client', entity_id: ID });
		expect(parseTaskEntityFilter(params)).toEqual({
			entity_type: 'client',
			entity_id: ID
		});
	});

	it('returns null when only one side is present', () => {
		expect(parseTaskEntityFilter(new URLSearchParams({ entity_type: 'client' }))).toBeNull();
		expect(parseTaskEntityFilter(new URLSearchParams({ entity_id: ID }))).toBeNull();
	});

	it('allows project entity type', () => {
		const params = new URLSearchParams({ entity_type: 'project', entity_id: ID });
		expect(parseTaskEntityFilter(params)).toEqual({
			entity_type: 'project',
			entity_id: ID
		});
	});

	it('rejects unknown task entity types', () => {
		const params = new URLSearchParams({ entity_type: 'invoice', entity_id: ID });
		expect(parseTaskEntityFilter(params)).toBeNull();
	});
});

describe('parseMeetingEntityFilter', () => {
	it('allows project related entities', () => {
		const params = new URLSearchParams({ entity_type: 'project', entity_id: ID });
		expect(parseMeetingEntityFilter(params)).toEqual({
			entity_type: 'project',
			entity_id: ID
		});
	});
});

describe('looksLikeVendorId', () => {
	it('accepts UUID vendor ids', () => {
		expect(looksLikeVendorId(ID)).toBe(true);
		expect(looksLikeVendorId('not-a-uuid')).toBe(false);
		expect(looksLikeVendorId(null)).toBe(false);
	});
});

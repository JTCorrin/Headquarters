import { describe, expect, it } from 'vitest';
import {
	readSelectedOrgId,
	SELECTED_ORG_STORAGE_KEY,
	writeSelectedOrgId,
	type StorageLike
} from './selected-org.js';

function memoryStorage(seed: Record<string, string> = {}): StorageLike {
	const map = new Map(Object.entries(seed));
	return {
		getItem: (key) => map.get(key) ?? null,
		setItem: (key, value) => {
			map.set(key, value);
		},
		removeItem: (key) => {
			map.delete(key);
		}
	};
}

describe('selected org persistence', () => {
	it('reads and writes the selected org id', () => {
		const storage = memoryStorage();
		expect(readSelectedOrgId(storage)).toBeNull();
		writeSelectedOrgId('org-1', storage);
		expect(readSelectedOrgId(storage)).toBe('org-1');
		expect(storage.getItem(SELECTED_ORG_STORAGE_KEY)).toBe('org-1');
		writeSelectedOrgId(null, storage);
		expect(readSelectedOrgId(storage)).toBeNull();
	});
});

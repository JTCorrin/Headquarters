import { describe, expect, it } from 'vitest';
import {
	isSelectedOrgStorageKey,
	readSelectedOrgId,
	SELECTED_ORG_STORAGE_KEY,
	selectedOrgStorageKey,
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

	it('isolates the selected organisation per authenticated user', () => {
		const storage = memoryStorage();
		writeSelectedOrgId('org-a', storage, 'user-a');
		writeSelectedOrgId('org-b', storage, 'user-b');

		expect(readSelectedOrgId(storage, 'user-a')).toBe('org-a');
		expect(readSelectedOrgId(storage, 'user-b')).toBe('org-b');
		expect(storage.getItem(selectedOrgStorageKey('user-a'))).toBe('org-a');
	});

	it('recognises unscoped and user-scoped storage keys', () => {
		expect(isSelectedOrgStorageKey(SELECTED_ORG_STORAGE_KEY)).toBe(true);
		expect(isSelectedOrgStorageKey(selectedOrgStorageKey('user-a'))).toBe(true);
		expect(isSelectedOrgStorageKey('hq.other')).toBe(false);
	});
});

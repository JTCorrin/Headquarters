import { describe, expect, it, vi } from 'vitest';
import { createOrgSession } from './session.svelte.js';
import type { StorageLike } from './selected-org.js';

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

describe('createOrgSession', () => {
	it('persists selection and bumps cache generation on switch', () => {
		const storage = memoryStorage();
		const onSwitch = vi.fn();
		const session = createOrgSession({ storage, onSwitch });

		expect(session.cacheGeneration).toBe(0);
		session.selectOrg('org-a');
		expect(session.selectedOrgId).toBe('org-a');
		expect(session.cacheGeneration).toBe(1);
		expect(onSwitch).toHaveBeenCalledWith('org-a', 1);
		expect(storage.getItem('hq.selected-org-id')).toBe('org-a');

		session.selectOrg('org-a');
		expect(session.cacheGeneration).toBe(1);

		session.selectOrg('org-b');
		expect(session.cacheGeneration).toBe(2);
		expect(onSwitch).toHaveBeenLastCalledWith('org-b', 2);
	});

	it('clears selection when memberships no longer include the org', () => {
		const session = createOrgSession({
			storage: memoryStorage(),
			initialOrgId: 'org-a',
			initialMemberships: [
				{
					org_id: 'org-a',
					org_name: 'A',
					org_slug: 'a',
					role: 'owner'
				}
			]
		});
		session.setMemberships([
			{ org_id: 'org-b', org_name: 'B', org_slug: 'b', role: 'member' }
		]);
		expect(session.selectedOrgId).toBeNull();
		expect(session.cacheGeneration).toBe(1);
	});
});

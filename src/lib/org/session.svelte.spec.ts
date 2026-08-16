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

	it('persists selection under a user-scoped key when a user id is provided', () => {
		const storage = memoryStorage();
		const session = createOrgSession({ storage, userId: 'user-1' });
		session.selectOrg('org-a');
		expect(storage.getItem('hq.selected-org-id')).toBeNull();
		expect(storage.getItem('hq.selected-org-id:user-1')).toBe('org-a');
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
					role: 'owner',
					theme_default: 'system'
				}
			]
		});
		session.setMemberships([
			{
				org_id: 'org-b',
				org_name: 'B',
				org_slug: 'b',
				role: 'member',
				theme_default: 'system'
			}
		]);
		expect(session.selectedOrgId).toBeNull();
		expect(session.cacheGeneration).toBe(1);
	});

	it('keeps the selected org when discovery returns no memberships', () => {
		const storage = memoryStorage({ 'hq.selected-org-id': 'org-a' });
		const session = createOrgSession({
			storage,
			initialOrgId: 'org-a',
			initialMemberships: [
				{
					org_id: 'org-a',
					org_name: 'A',
					org_slug: 'a',
					role: 'owner',
					theme_default: 'system'
				}
			]
		});
		session.setMemberships([]);
		expect(session.selectedOrgId).toBe('org-a');
		expect(storage.getItem('hq.selected-org-id')).toBe('org-a');
	});

	it('tracks theme preference and patches org theme_default', () => {
		const session = createOrgSession({
			storage: memoryStorage(),
			initialOrgId: 'org-a',
			initialMemberships: [
				{
					org_id: 'org-a',
					org_name: 'A',
					org_slug: 'a',
					role: 'owner',
					theme_default: 'system'
				}
			]
		});
		expect(session.themePreference).toBe('org_default');
		session.setThemePreference('dark');
		expect(session.themePreference).toBe('dark');
		session.patchOrgThemeDefault('org-a', 'dark');
		expect(session.memberships[0]?.theme_default).toBe('dark');
		session.patchOrgLogoUrl('org-a', 'https://example.test/logo.png');
		expect(session.memberships[0]?.logo_url).toBe('https://example.test/logo.png');
	});
});

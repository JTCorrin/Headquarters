import { describe, expect, it } from 'vitest';
import { isAuthPublicPath, isOnboardingPath, postAuthDestination } from './paths.js';

describe('auth paths', () => {
	it('recognises public and onboarding paths', () => {
		expect(isAuthPublicPath('/login')).toBe(true);
		expect(isAuthPublicPath('/org/config')).toBe(false);
		expect(isOnboardingPath('/onboarding/create-org')).toBe(true);
		expect(isOnboardingPath('/onboarding/invite-team')).toBe(true);
	});

	it('routes post-auth destinations', () => {
		expect(postAuthDestination({ membershipCount: 0, selectedOrgId: null })).toBe(
			'/onboarding/create-org'
		);
		expect(postAuthDestination({ membershipCount: 1, selectedOrgId: null })).toBe(
			'/select-org'
		);
		expect(
			postAuthDestination({
				membershipCount: 1,
				selectedOrgId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
			})
		).toBe('/org/config');
		expect(postAuthDestination({ membershipCount: 2, selectedOrgId: null })).toBe(
			'/select-org'
		);
	});
});

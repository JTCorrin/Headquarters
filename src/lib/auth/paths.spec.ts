import { describe, expect, it } from 'vitest';
import {
	isAuthPublicPath,
	isOnboardingPath,
	postAuthDestination,
	requiresSelectedOrg
} from './paths.js';

describe('auth paths', () => {
	it('recognises public and onboarding paths', () => {
		expect(isAuthPublicPath('/login')).toBe(true);
		expect(isAuthPublicPath('/org/config')).toBe(false);
		expect(isOnboardingPath('/onboarding/create-org')).toBe(true);
		expect(isOnboardingPath('/onboarding/invite-team')).toBe(true);
	});

	it('requires selected org for org-scoped app routes', () => {
		expect(requiresSelectedOrg('/')).toBe(true);
		expect(requiresSelectedOrg('/org/config')).toBe(true);
		expect(requiresSelectedOrg('/contacts')).toBe(true);
		expect(requiresSelectedOrg('/contacts/abc')).toBe(true);
		expect(requiresSelectedOrg('/quotes')).toBe(true);
		expect(requiresSelectedOrg('/quotes/abc')).toBe(true);
		expect(requiresSelectedOrg('/invoices')).toBe(true);
		expect(requiresSelectedOrg('/invoices/abc')).toBe(true);
		expect(requiresSelectedOrg('/recurring-invoices')).toBe(true);
		expect(requiresSelectedOrg('/recurring-invoices/abc')).toBe(true);
		expect(requiresSelectedOrg('/bills')).toBe(true);
		expect(requiresSelectedOrg('/bills/abc')).toBe(true);
		expect(requiresSelectedOrg('/payments')).toBe(true);
		expect(requiresSelectedOrg('/payments/abc')).toBe(true);
		expect(requiresSelectedOrg('/products')).toBe(true);
		expect(requiresSelectedOrg('/products/abc')).toBe(true);
		expect(requiresSelectedOrg('/documents')).toBe(true);
		expect(requiresSelectedOrg('/documents/abc')).toBe(true);
		expect(requiresSelectedOrg('/email')).toBe(true);
		expect(requiresSelectedOrg('/email/templates')).toBe(true);
		expect(requiresSelectedOrg('/email/templates/abc')).toBe(true);
		expect(requiresSelectedOrg('/leads')).toBe(true);
		expect(requiresSelectedOrg('/leads/abc')).toBe(true);
		expect(requiresSelectedOrg('/clients')).toBe(true);
		expect(requiresSelectedOrg('/clients/abc')).toBe(true);
		expect(requiresSelectedOrg('/tasks')).toBe(true);
		expect(requiresSelectedOrg('/tasks/abc')).toBe(true);
		expect(requiresSelectedOrg('/meetings')).toBe(true);
		expect(requiresSelectedOrg('/meetings/abc')).toBe(true);
		expect(requiresSelectedOrg('/meetings/calendar')).toBe(true);
		expect(requiresSelectedOrg('/projects')).toBe(true);
		expect(requiresSelectedOrg('/projects/abc')).toBe(true);
		expect(requiresSelectedOrg('/settings')).toBe(true);
		expect(requiresSelectedOrg('/select-org')).toBe(false);
		expect(requiresSelectedOrg('/login')).toBe(false);
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
		).toBe('/');
		expect(postAuthDestination({ membershipCount: 2, selectedOrgId: null })).toBe(
			'/select-org'
		);
		expect(
			postAuthDestination({
				membershipCount: 2,
				selectedOrgId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
			})
		).toBe('/');
	});
});

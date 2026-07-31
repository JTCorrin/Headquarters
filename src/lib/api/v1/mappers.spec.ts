import { describe, expect, it } from 'vitest';
import {
	themePreferenceFromApi,
	themePreferenceToApi,
	toOrganisationCreateBody,
	toOrgMembershipSummary
} from './mappers.js';

describe('api mappers', () => {
	it('maps create form fields to API body', () => {
		expect(
			toOrganisationCreateBody({
				name: 'Corrin Data',
				slug: 'corrin-data',
				timezone: 'Europe/London',
				currency: 'GBP',
				locale: 'en-GB',
				country: 'GB'
			})
		).toEqual({
			name: 'Corrin Data',
			slug: 'corrin-data',
			country_code: 'GB',
			default_currency: 'GBP',
			timezone: 'Europe/London',
			locale: 'en-GB'
		});
	});

	it('maps theme preference null ↔ org_default', () => {
		expect(themePreferenceToApi('org_default')).toBeNull();
		expect(themePreferenceToApi('dark')).toBe('dark');
		expect(themePreferenceFromApi(null)).toBe('org_default');
		expect(themePreferenceFromApi('light')).toBe('light');
	});

	it('maps discovery rows to switcher summaries', () => {
		expect(
			toOrgMembershipSummary({
				membership: {
					id: 'm1',
					role: 'admin',
					status: 'active',
					joined_at: null
				},
				organisation: {
					id: 'org-1',
					name: 'Acme',
					slug: 'acme',
					logo_path: '/logo.png',
					default_currency: 'USD',
					timezone: 'UTC',
					locale: 'en-US',
					country_code: 'US',
					theme_default: 'light'
				}
			})
		).toEqual({
			org_id: 'org-1',
			org_name: 'Acme',
			org_slug: 'acme',
			logo_url: '/logo.png',
			role: 'admin'
		});
	});
});

import { describe, expect, it } from 'vitest';
import {
	organisationConfigSchema,
	organisationCreateSchema,
	profilePreferencesSchema,
	slugifyOrganisationName,
	taxRateFormSchema
} from './organisation.js';

describe('organisation schemas', () => {
	it('slugifies organisation names', () => {
		expect(slugifyOrganisationName('Corrin Data Ltd')).toBe('corrin-data-ltd');
		expect(slugifyOrganisationName('  Certivue!! ')).toBe('certivue');
	});

	it('rejects invalid create payloads', () => {
		const result = organisationCreateSchema.safeParse({
			name: '',
			slug: 'Bad Slug',
			timezone: '',
			currency: 'gbp',
			locale: 'x',
			country: 'gb'
		});
		expect(result.success).toBe(false);
	});

	it('accepts a valid create payload', () => {
		const result = organisationCreateSchema.safeParse({
			name: 'Corrin Data',
			slug: 'corrin-data',
			timezone: 'Europe/London',
			currency: 'GBP',
			locale: 'en-GB',
			country: 'GB'
		});
		expect(result.success).toBe(true);
	});

	it('rejects shape-valid but non-IANA timezones', () => {
		const result = organisationCreateSchema.safeParse({
			name: 'Corrin Data',
			slug: 'corrin-data',
			timezone: 'Not/A_Zone',
			currency: 'GBP',
			locale: 'en-GB',
			country: 'GB'
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.some((issue) => /IANA timezone/i.test(issue.message))).toBe(
				true
			);
		}
	});

	it('bounds tax rate percent', () => {
		expect(
			taxRateFormSchema.safeParse({
				name: 'VAT',
				ratePercent: '20',
				isDefault: 'true',
				active: 'true'
			}).success
		).toBe(true);
		expect(
			taxRateFormSchema.safeParse({
				name: 'VAT',
				ratePercent: '100.0001',
				isDefault: 'false',
				active: 'true'
			}).success
		).toBe(false);
	});

	it('accepts org config and theme preference enums', () => {
		expect(
			organisationConfigSchema.safeParse({
				timezone: 'Europe/London',
				currency: 'USD',
				locale: 'en-US',
				themeDefault: 'dark'
			}).success
		).toBe(true);
		expect(
			organisationConfigSchema.safeParse({
				timezone: 'UTC',
				currency: 'GBP',
				locale: 'en-GB',
				themeDefault: 'system'
			}).success
		).toBe(true);
		expect(
			profilePreferencesSchema.safeParse({ themePreference: 'org_default' }).success
		).toBe(true);
	});
});

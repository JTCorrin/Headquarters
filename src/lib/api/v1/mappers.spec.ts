import { describe, expect, it } from 'vitest';
import {
	contactLifecycleLabel,
	quoteStatusLabel,
	themePreferenceFromApi,
	themePreferenceToApi,
	toContactCreateBody,
	toContactFormData,
	toContactListItem,
	toOrganisationCreateBody,
	toOrgMembershipSummary,
	toQuoteCreateBody,
	toQuoteListItem
} from './mappers.js';
import type { ApiContact, ApiQuote } from './types.js';

const sampleContact: ApiContact = {
	id: '11111111-2222-4333-8444-555555555555',
	org_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
	created_at: '2026-01-01T00:00:00Z',
	updated_at: '2026-01-01T00:00:00Z',
	created_by: null,
	updated_by: null,
	deleted_at: null,
	version: 1,
	first_name: 'Ava',
	last_name: 'Chen',
	display_name: 'Ava Chen',
	primary_email: 'ava@northwind.com',
	primary_phone: '+44 7700 900123',
	job_title: 'Head of Operations',
	company_name: 'Northwind',
	owner_membership_id: null,
	lifecycle_status: 'active',
	source: null,
	notes: null,
	last_contacted_at: null,
	metadata: {}
};

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
			role: 'admin',
			theme_default: 'light'
		});
	});

	it('maps contacts between API and form/list shapes', () => {
		expect(contactLifecycleLabel('inactive')).toBe('Inactive');
		expect(toContactListItem(sampleContact)).toEqual({
			id: sampleContact.id,
			name: 'Ava Chen',
			email: 'ava@northwind.com',
			company: 'Northwind',
			status: 'Active',
			owner: undefined
		});
		expect(toContactFormData(sampleContact)).toEqual({
			name: 'Ava Chen',
			email: 'ava@northwind.com',
			phone: '+44 7700 900123',
			company: 'Northwind',
			title: 'Head of Operations',
			status: 'active'
		});
		expect(
			toContactCreateBody({
				name: '  Sam Ortiz  ',
				email: '',
				phone: ' ',
				company: 'Contoso',
				title: '',
				status: 'active'
			})
		).toEqual({
			display_name: 'Sam Ortiz',
			primary_email: null,
			primary_phone: null,
			company_name: 'Contoso',
			job_title: null,
			lifecycle_status: 'active'
		});
	});

	it('maps quotes between API and form/list shapes', () => {
		const sampleQuote: ApiQuote = {
			id: '11111111-2222-4333-8444-555555555555',
			org_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
			created_at: '2026-01-01T00:00:00Z',
			updated_at: '2026-01-01T00:00:00Z',
			created_by: null,
			updated_by: null,
			deleted_at: null,
			version: 1,
			number: 'Q-0001',
			title: 'Pilot quote',
			client_id: 'cccccccc-cccc-4ddd-8eee-ffffffffffff',
			lead_id: null,
			contact_id: null,
			owner_membership_id: null,
			status: 'draft',
			currency: 'GBP',
			issue_on: '2026-01-01',
			valid_until: '2026-02-01',
			subtotal_cents: 1000,
			discount_cents: 0,
			tax_cents: 200,
			total_cents: 1200,
			party_snapshot: { name: 'Northwind' },
			terms: null,
			notes: null,
			internal_notes: null,
			sent_at: null,
			viewed_at: null,
			accepted_at: null,
			rejected_at: null,
			converted_invoice_id: null
		};
		expect(quoteStatusLabel('draft')).toBe('Draft');
		expect(toQuoteListItem(sampleQuote)).toEqual({
			id: sampleQuote.id,
			number: 'Q-0001',
			client: 'Northwind',
			total: '£12.00',
			status: 'Draft',
			validUntil: '2026-02-01'
		});
		expect(
			toQuoteCreateBody({
				clientId: sampleQuote.client_id!,
				clientName: 'Northwind',
				title: '  Pilot quote  ',
				currency: 'GBP',
				status: 'draft'
			})
		).toEqual({
			title: 'Pilot quote',
			client_id: sampleQuote.client_id,
			currency: 'GBP',
			lines: []
		});
	});
});

import { describe, expect, it } from 'vitest';
import {
	clientStatusLabel,
	contactLifecycleLabel,
	leadStageLabel,
	quoteStatusLabel,
	themePreferenceFromApi,
	themePreferenceToApi,
	toClientCreateBody,
	toClientFormData,
	toClientRow,
	toContactCreateBody,
	toContactFormData,
	toContactListItem,
	toLeadCard,
	toLeadCreateBody,
	toLeadFormData,
	toOrganisationCreateBody,
	toOrgMembershipSummary,
	toQuoteCreateBody,
	toQuoteListItem
} from './mappers.js';
import type { ApiClient, ApiContact, ApiLead, ApiQuote } from './types.js';

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
			status: 'active',
			clientId: ''
		});
		expect(
			toContactCreateBody({
				name: '  Sam Ortiz  ',
				email: '',
				phone: ' ',
				company: 'Contoso',
				title: '',
				status: 'active',
				clientId: ''
			})
		).toEqual({
			display_name: 'Sam Ortiz',
			primary_email: null,
			primary_phone: null,
			company_name: 'Contoso',
			job_title: null,
			lifecycle_status: 'active',
			client_id: null
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

	it('maps leads between API and form/board shapes', () => {
		const sampleLead: ApiLead = {
			id: '11111111-2222-4333-8444-555555555555',
			org_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
			created_at: '2026-01-01T00:00:00Z',
			updated_at: '2026-01-01T00:00:00Z',
			created_by: null,
			updated_by: null,
			deleted_at: null,
			version: 2,
			name: 'Contoso expansion',
			company_name: 'Contoso',
			contact_id: null,
			client_id: null,
			stage: 'qualified',
			value_cents: 250000,
			currency: 'GBP',
			probability_percent: 40,
			source: 'referral',
			owner_membership_id: null,
			expected_close_on: '2026-09-01',
			lost_reason: null,
			won_at: null,
			lost_at: null,
			converted_at: null,
			position: 1,
			notes: 'Hot',
			metadata: {}
		};
		expect(leadStageLabel('qualified')).toBe('Qualified');
		expect(toLeadCard(sampleLead)).toMatchObject({
			id: sampleLead.id,
			name: 'Contoso expansion',
			companyName: 'Contoso',
			stage: 'qualified',
			valueCents: 250000
		});
		expect(toLeadFormData(sampleLead)).toMatchObject({
			name: 'Contoso expansion',
			stage: 'qualified',
			valueAmount: '2500',
			currency: 'GBP',
			clientId: ''
		});
		expect(
			toLeadCreateBody({
				name: '  Northwind pilot  ',
				companyName: '',
				clientId: '',
				stage: 'new',
				valueAmount: '10',
				currency: 'USD',
				probabilityPercent: '',
				source: '',
				expectedCloseOn: '',
				lostReason: '',
				notes: ''
			})
		).toEqual({
			name: 'Northwind pilot',
			company_name: null,
			client_id: null,
			stage: 'new',
			value_cents: 1000,
			currency: 'USD',
			probability_percent: null,
			source: null,
			expected_close_on: null,
			lost_reason: null,
			notes: null
		});
	});

	it('maps clients between API and form/list shapes', () => {
		const sampleClient: ApiClient = {
			id: 'cccccccc-cccc-4ddd-8eee-ffffffffffff',
			org_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
			created_at: '2026-01-01T00:00:00Z',
			updated_at: '2026-01-01T00:00:00Z',
			created_by: null,
			updated_by: null,
			deleted_at: null,
			version: 1,
			name: 'Northwind',
			status: 'on_hold',
			website_url: 'https://northwind.example',
			industry: 'Logistics',
			primary_email: 'billing@northwind.com',
			phone: null,
			tax_identifier: null,
			registration_number: null,
			default_currency: 'GBP',
			payment_terms_days: 30,
			owner_membership_id: null,
			converted_from_lead_id: null,
			renewal_on: null,
			notes: null,
			metadata: {}
		};
		expect(clientStatusLabel('on_hold')).toBe('On Hold');
		expect(toClientRow(sampleClient)).toMatchObject({
			id: sampleClient.id,
			name: 'Northwind',
			status: 'On Hold'
		});
		expect(toClientFormData(sampleClient)).toMatchObject({
			name: 'Northwind',
			status: 'on_hold',
			defaultCurrency: 'GBP',
			paymentTermsDays: '30'
		});
		expect(
			toClientCreateBody({
				name: '  Adventure Works  ',
				status: 'active',
				websiteUrl: '',
				industry: 'Retail',
				primaryEmail: '',
				phone: '',
				taxIdentifier: '',
				registrationNumber: '',
				defaultCurrency: 'EUR',
				paymentTermsDays: '',
				renewalOn: '',
				notes: ''
			})
		).toEqual({
			name: 'Adventure Works',
			status: 'active',
			website_url: null,
			industry: 'Retail',
			primary_email: null,
			phone: null,
			tax_identifier: null,
			registration_number: null,
			default_currency: 'EUR',
			payment_terms_days: null,
			renewal_on: null,
			notes: null
		});
	});
});

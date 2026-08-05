import { describe, expect, it } from 'vitest';
import {
	clientStatusLabel,
	contactLifecycleLabel,
	invoiceStatusLabel,
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
	toInvoiceCreateBody,
	toInvoiceFormData,
	toInvoiceLineInput,
	lineItemRowsToInvoiceLineInputs,
	lineItemRowsToQuoteLineInputs,
	recipientsFromDocument,
	toCatalogProductOption,
	toProductCreateBody,
	toProductRow,
	toQuoteLineInput,
	toRecurringLineInput,
	toInvoiceListItem,
	toLeadCard,
	toLeadCreateBody,
	toLeadFormData,
	toOrganisationCreateBody,
	toOrgMembershipSummary,
	toPaymentCreateBody,
	toPaymentListItem,
	paymentStatusLabel,
	toQuoteCreateBody,
	toQuoteListItem
} from './mappers.js';
import type {
	ApiClient,
	ApiContact,
	ApiInvoice,
	ApiLead,
	ApiPayment,
	ApiQuote
} from './types.js';

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
	client_id: 'cccccccc-cccc-4ddd-8eee-ffffffffffff',
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
			membership_id: 'm1',
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
				status: 'draft',
				recipients: []
			})
		).toEqual({
			title: 'Pilot quote',
			client_id: sampleQuote.client_id,
			currency: 'GBP',
			contact_id: null,
			recipients: [],
			lines: []
		});
	});

	it('maps invoices between API and form/list shapes with decimal lines', () => {
		const sampleInvoice: ApiInvoice = {
			id: 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb',
			org_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
			created_at: '2026-01-01T00:00:00Z',
			updated_at: '2026-01-01T00:00:00Z',
			created_by: null,
			updated_by: null,
			deleted_at: null,
			version: 1,
			number: 'INV-0001',
			client_id: 'cccccccc-cccc-4ddd-8eee-ffffffffffff',
			contact_id: null,
			quote_id: null,
			owner_membership_id: null,
			source: 'manual',
			recurring_run_id: null,
			billing_period_start: null,
			billing_period_end: null,
			status: 'draft',
			currency: 'GBP',
			issue_on: '2026-03-01',
			due_on: '2026-04-01',
			purchase_order_number: 'PO-9',
			subtotal_cents: 1000,
			discount_cents: 0,
			tax_cents: 200,
			total_cents: 1200,
			paid_cents: 0,
			balance_due_cents: 1200,
			party_snapshot: { name: 'Northwind' },
			payment_terms: null,
			notes: null,
			internal_notes: null,
			sent_at: null,
			viewed_at: null,
			paid_at: null,
			voided_at: null,
			void_reason: null
		};
		expect(invoiceStatusLabel('draft')).toBe('Draft');
		expect(toInvoiceListItem(sampleInvoice)).toEqual({
			id: sampleInvoice.id,
			number: 'INV-0001',
			client: 'Northwind',
			total: '£12.00',
			status: 'Draft',
			dueOn: '2026-04-01'
		});
		expect(
			toInvoiceCreateBody({
				clientId: sampleInvoice.client_id,
				clientName: 'Northwind',
				recipients: [],
				currency: 'GBP',
				issueOn: '2026-03-01',
				dueOn: '2026-04-01',
				purchaseOrderNumber: ' PO-9 ',
				status: 'draft',
				quoteId: ''
			})
		).toEqual({
			client_id: sampleInvoice.client_id,
			contact_id: null,
			recipients: [],
			currency: 'GBP',
			issue_on: '2026-03-01',
			due_on: '2026-04-01',
			purchase_order_number: 'PO-9',
			lines: []
		});
		const contactA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
		const contactB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
		expect(
			recipientsFromDocument({
				contact_id: contactA,
				recipients: [
					{
						contact_id: contactB,
						is_billing: false,
						position: 1
					},
					{
						contact_id: contactA,
						is_billing: true,
						position: 0
					}
				]
			})
		).toEqual([
			{ contactId: contactA, isBilling: true },
			{ contactId: contactB, isBilling: false }
		]);
		expect(
			toInvoiceFormData({
				...sampleInvoice,
				contact_id: contactA,
				recipients: [
					{ contact_id: contactA, is_billing: true, position: 0 },
					{ contact_id: contactB, is_billing: false, position: 1 }
				]
			} as ApiInvoice).recipients
		).toEqual([
			{ contactId: contactA, isBilling: true },
			{ contactId: contactB, isBilling: false }
		]);
		expect(
			toInvoiceCreateBody({
				clientId: sampleInvoice.client_id,
				clientName: 'Northwind',
				currency: 'GBP',
				issueOn: '2026-03-01',
				dueOn: '2026-04-01',
				purchaseOrderNumber: '',
				status: 'draft',
				quoteId: '',
				recipients: [
					{ contactId: contactA, isBilling: true },
					{ contactId: contactB, isBilling: false }
				]
			})
		).toEqual({
			client_id: sampleInvoice.client_id,
			contact_id: contactA,
			recipients: [
				{ contact_id: contactA, is_billing: true },
				{ contact_id: contactB, is_billing: false }
			],
			currency: 'GBP',
			issue_on: '2026-03-01',
			due_on: '2026-04-01',
			purchase_order_number: null,
			lines: []
		});
		expect(
			toInvoiceLineInput({
				productId: '',
				description: 'Consulting',
				qty: '1.5',
				unitPrice: '12.50',
				taxRatePercent: '20'
			})
		).toEqual({
			product_id: null,
			description: 'Consulting',
			quantity: 1.5,
			unit_price_cents: 1250,
			tax_rate_percent: 20
		});
		expect(
			lineItemRowsToInvoiceLineInputs([
				{
					productId: 'dddddddd-dddd-4eee-8fff-000000000001',
					description: 'Retainer',
					qty: '2',
					unitPrice: '10.00',
					discountPercent: 5,
					taxRatePercent: 20
				}
			])
		).toEqual([
			{
				product_id: 'dddddddd-dddd-4eee-8fff-000000000001',
				description: 'Retainer',
				quantity: 2,
				unit_price_cents: 1000,
				discount_percent: 5,
				tax_rate_percent: 20,
				position: 0
			}
		]);
		expect(
			toQuoteLineInput({
				productId: 'dddddddd-dddd-4eee-8fff-000000000001',
				description: 'Catalog line',
				qty: '3',
				unitPrice: '12.00',
				taxRatePercent: '20'
			})
		).toEqual({
			product_id: 'dddddddd-dddd-4eee-8fff-000000000001',
			description: 'Catalog line',
			quantity: 3,
			unit_price_cents: 1200,
			tax_rate_percent: 20
		});
		expect(
			toRecurringLineInput({
				productId: '',
				descriptionTemplate: 'Retainer {{period_start}}',
				qty: '1.5',
				unitPrice: '100.00',
				taxRatePercent: '20'
			})
		).toEqual({
			description_template: 'Retainer {{period_start}}',
			quantity: 1.5,
			unit_price_cents: 10000,
			discount_percent: 0,
			tax_rate_percent: 20
		});
		expect(
			toRecurringLineInput(
				{
					productId: 'dddddddd-dddd-4eee-8fff-000000000001',
					descriptionTemplate: 'Catalog line',
					qty: '2',
					unitPrice: '10.00',
					taxRatePercent: ''
				},
				1
			)
		).toEqual({
			product_id: 'dddddddd-dddd-4eee-8fff-000000000001',
			description_template: 'Catalog line',
			quantity: 2,
			unit_price_cents: 1000,
			discount_percent: 0,
			tax_rate_percent: 0,
			position: 1
		});
		expect(
			lineItemRowsToQuoteLineInputs([
				{
					productId: 'dddddddd-dddd-4eee-8fff-000000000001',
					description: 'Catalog line',
					qty: '3',
					unitPrice: '12.00',
					discountPercent: 0,
					taxRatePercent: 20
				}
			])
		).toEqual([
			{
				product_id: 'dddddddd-dddd-4eee-8fff-000000000001',
				description: 'Catalog line',
				quantity: 3,
				unit_price_cents: 1200,
				discount_percent: 0,
				tax_rate_percent: 20,
				position: 0
			}
		]);
		expect(
			toProductCreateBody({
				sku: 'WID-1',
				name: 'Widget',
				description: '',
				unitPrice: '25.00',
				taxRateId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
				trackStock: true,
				stockQty: '4',
				status: 'active'
			})
		).toEqual({
			sku: 'WID-1',
			name: 'Widget',
			description: null,
			product_type: 'product',
			unit_price_cents: 2500,
			currency: 'GBP',
			tax_rate_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
			track_stock: true,
			status: 'active'
		});
		expect(
			toProductRow({
				id: 'dddddddd-dddd-4eee-8fff-000000000001',
				org_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
				created_at: '2026-01-01T00:00:00Z',
				updated_at: '2026-01-01T00:00:00Z',
				created_by: null,
				updated_by: null,
				deleted_at: null,
				version: 1,
				sku: 'WID-1',
				name: 'Widget',
				description: null,
				category_id: null,
				product_type: 'product',
				unit_name: null,
				unit_price_cents: 2500,
				cost_price_cents: null,
				currency: 'GBP',
				tax_rate_id: null,
				track_stock: true,
				stock_qty: 4,
				low_stock_at: 2,
				status: 'active',
				metadata: {}
			})
		).toMatchObject({
			id: 'dddddddd-dddd-4eee-8fff-000000000001',
			sku: 'WID-1',
			name: 'Widget',
			stock: 4,
			lowStockAt: 2,
			status: 'Active'
		});
		expect(
			toCatalogProductOption({
				id: 'dddddddd-dddd-4eee-8fff-000000000001',
				org_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
				created_at: '2026-01-01T00:00:00Z',
				updated_at: '2026-01-01T00:00:00Z',
				created_by: null,
				updated_by: null,
				deleted_at: null,
				version: 1,
				sku: 'WID-1',
				name: 'Widget',
				description: null,
				category_id: null,
				product_type: 'product',
				unit_name: null,
				unit_price_cents: 2500,
				cost_price_cents: null,
				currency: 'GBP',
				tax_rate_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
				track_stock: false,
				stock_qty: 0,
				low_stock_at: null,
				status: 'active',
				metadata: {}
			}, [{ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', rate_percent: 20 }])
		).toEqual({
			id: 'dddddddd-dddd-4eee-8fff-000000000001',
			sku: 'WID-1',
			name: 'Widget',
			unitPrice: '25',
			taxRateId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
			taxRatePercent: '20'
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

	it('maps payments create body and list rows', () => {
		const samplePayment: ApiPayment = {
			id: 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb',
			org_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
			created_at: '2026-01-01T00:00:00Z',
			updated_at: '2026-01-01T00:00:00Z',
			created_by: null,
			updated_by: null,
			version: 1,
			direction: 'inbound',
			client_id: 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee',
			vendor_id: null,
			amount_cents: 420000,
			currency: 'GBP',
			method: 'bank',
			status: 'unallocated',
			occurred_on: '2026-03-18',
			reference: 'REF-1',
			provider: 'manual',
			provider_payment_id: null,
			notes: null,
			reverses_payment_id: null,
			completed_at: null,
			metadata: {}
		};
		expect(paymentStatusLabel('part_allocated')).toBe('Part Allocated');
		expect(
			toPaymentListItem(samplePayment, { clientName: 'Northwind' })
		).toMatchObject({
			party: 'Northwind',
			amount: '£4,200.00',
			status: 'Unallocated',
			direction: 'Inbound',
			method: 'Bank'
		});
		expect(
			toPaymentCreateBody({
				direction: 'inbound',
				clientId: samplePayment.client_id!,
				clientName: 'Northwind',
				vendorId: '',
				vendorName: '',
				invoiceId: 'cccccccc-cccc-4ddd-8eee-ffffffffffff',
				billId: '',
				amount: '42.00',
				currency: 'GBP',
				method: 'bank',
				occurredOn: '2026-03-18',
				reference: ' REF-1 ',
				notes: ''
			})
		).toEqual({
			direction: 'inbound',
			client_id: samplePayment.client_id,
			vendor_id: null,
			amount_cents: 4200,
			currency: 'GBP',
			method: 'bank',
			occurred_on: '2026-03-18',
			provider: 'manual',
			reference: 'REF-1',
			notes: null,
			allocations: [
				{
					invoice_id: 'cccccccc-cccc-4ddd-8eee-ffffffffffff',
					amount_cents: 4200
				}
			]
		});
	});
});

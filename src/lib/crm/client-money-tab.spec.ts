import { describe, expect, it } from 'vitest';
import type { ApiInvoice, ApiPayment, ApiQuote } from '$lib/api/v1/types.js';
import {
	mergeClientMoneyItems,
	toMoneySummaryItemFromInvoice,
	toMoneySummaryItemFromPayment,
	toMoneySummaryItemFromQuote
} from './client-money-tab.js';

const ORG = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CLIENT = 'cccccccc-cccc-4ddd-8eee-ffffffffffff';

function quote(overrides: Partial<ApiQuote> = {}): ApiQuote {
	return {
		id: '11111111-1111-4111-8111-111111111111',
		org_id: ORG,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		created_by: null,
		updated_by: null,
		deleted_at: null,
		version: 1,
		number: 'Q-0140',
		title: 'Annual',
		client_id: CLIENT,
		lead_id: null,
		contact_id: null,
		owner_membership_id: null,
		status: 'accepted',
		currency: 'GBP',
		issue_on: '2026-01-08',
		valid_until: null,
		subtotal_cents: 1800000,
		discount_cents: 0,
		tax_cents: 0,
		total_cents: 1800000,
		party_snapshot: null,
		terms: null,
		notes: null,
		internal_notes: null,
		sent_at: null,
		viewed_at: null,
		accepted_at: null,
		rejected_at: null,
		converted_invoice_id: null,
		...overrides
	};
}

function invoice(overrides: Partial<ApiInvoice> = {}): ApiInvoice {
	return {
		id: '22222222-2222-4222-8222-222222222222',
		org_id: ORG,
		created_at: '2026-02-01T00:00:00Z',
		updated_at: '2026-02-01T00:00:00Z',
		created_by: null,
		updated_by: null,
		deleted_at: null,
		version: 1,
		number: 'INV-0875',
		client_id: CLIENT,
		contact_id: null,
		quote_id: null,
		owner_membership_id: null,
		source: 'manual',
		recurring_run_id: null,
		billing_period_start: null,
		billing_period_end: null,
		status: 'paid',
		currency: 'GBP',
		issue_on: '2026-02-01',
		due_on: '2026-03-01',
		purchase_order_number: null,
		subtotal_cents: 450000,
		discount_cents: 0,
		tax_cents: 0,
		total_cents: 450000,
		paid_cents: 450000,
		balance_due_cents: 0,
		party_snapshot: null,
		payment_terms: null,
		notes: null,
		internal_notes: null,
		sent_at: null,
		viewed_at: null,
		paid_at: null,
		voided_at: null,
		void_reason: null,
		...overrides
	};
}

function payment(overrides: Partial<ApiPayment> = {}): ApiPayment {
	return {
		id: '33333333-3333-4333-8333-333333333333',
		org_id: ORG,
		created_at: '2026-02-03T00:00:00Z',
		updated_at: '2026-02-03T00:00:00Z',
		created_by: null,
		updated_by: null,
		version: 1,
		direction: 'inbound',
		client_id: CLIENT,
		vendor_id: null,
		amount_cents: 450000,
		currency: 'GBP',
		method: 'bank',
		status: 'allocated',
		occurred_on: '2026-02-03',
		reference: 'INV-0875',
		provider: null,
		provider_payment_id: null,
		notes: null,
		reverses_payment_id: null,
		completed_at: null,
		metadata: null,
		...overrides
	};
}

describe('client money tab mappers', () => {
	it('maps quote/invoice/payment rows with links for documents only', () => {
		const q = toMoneySummaryItemFromQuote(quote());
		expect(q).toMatchObject({
			kind: 'quote',
			label: 'Q-0140 · Annual',
			amount: '£18,000.00',
			status: 'Accepted',
			date: '8 Jan',
			href: '/quotes/11111111-1111-4111-8111-111111111111'
		});

		const inv = toMoneySummaryItemFromInvoice(invoice());
		expect(inv).toMatchObject({
			kind: 'invoice',
			label: 'INV-0875',
			amount: '£4,500.00',
			status: 'Paid',
			href: '/invoices/22222222-2222-4222-8222-222222222222'
		});

		const pay = toMoneySummaryItemFromPayment(payment());
		expect(pay).toMatchObject({
			kind: 'payment',
			label: 'Bank · INV-0875',
			amount: '£4,500.00',
			status: 'Allocated'
		});
		expect(pay.href).toBeUndefined();
	});

	it('sorts newest first across kinds', () => {
		const items = mergeClientMoneyItems(
			[quote({ issue_on: '2026-01-08' })],
			[invoice({ issue_on: '2026-02-01' })],
			[payment({ occurred_on: '2026-02-03' })]
		);
		expect(items.map((i) => i.kind)).toEqual(['payment', 'invoice', 'quote']);
	});
});

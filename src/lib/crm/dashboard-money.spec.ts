import { describe, expect, it } from 'vitest';
import type { ApiDashboardSummary } from '$lib/api/v1/types.js';
import {
	dashboardAgingFromSummary,
	dashboardAttentionFromSummary,
	dashboardCurrencyHint,
	dashboardPipelineFromSummary,
	dashboardStatsFromSummary,
	dashboardTrendFromSummary,
	formatDashboardMoney
} from './dashboard-money.js';

const sampleSummary = (): ApiDashboardSummary => ({
	currency: 'GBP',
	as_of: '2026-08-14',
	kpis: {
		outstanding_cents: 1840000,
		overdue_cents: 496000,
		open_invoice_count: 12,
		overdue_invoice_count: 3,
		cash_collected_30d_cents: 1225000,
		cash_collected_prior_30d_cents: 1000000,
		booked_30d_cents: 2180000,
		booked_prior_30d_cents: 2000000
	},
	aging: [
		{ bucket: 'current', cents: 820000, count: 6 },
		{ bucket: '1_30', cents: 296000, count: 2 },
		{ bucket: '31_60', cents: 480000, count: 2 },
		{ bucket: '61_90', cents: 144000, count: 1 },
		{ bucket: '90_plus', cents: 100000, count: 1 }
	],
	monthly: [
		{ month: '2026-03', cash_cents: 1, booked_cents: 2 },
		{ month: '2026-08', cash_cents: 3, booked_cents: 4 }
	],
	quote_pipeline: [
		{ status: 'draft', count: 1, total_cents: 1000 },
		{ status: 'sent', count: 2, total_cents: 2000 },
		{ status: 'accepted', count: 0, total_cents: 0 },
		{ status: 'rejected', count: 0, total_cents: 0 }
	],
	chase: {
		overdue_invoices: [
			{
				id: 'inv-1',
				number: 'INV-0883',
				client_name: 'Fabrikam',
				amount_cents: 96000,
				days: 21
			}
		],
		due_soon_invoices: [],
		awaiting_quotes: [
			{
				id: 'q-1',
				number: 'Q-0142',
				client_name: 'Northwind',
				amount_cents: 480000,
				days: 5
			}
		],
		expiring_quotes: []
	},
	other_currency_doc_count: 2
});

describe('dashboard-money mappers', () => {
	it('formats money and KPI cards', () => {
		expect(formatDashboardMoney(1225000, 'GBP')).toContain('12,250');
		const stats = dashboardStatsFromSummary(sampleSummary());
		expect(stats[0]?.label).toBe('Outstanding AR');
		expect(stats[0]?.hint).toContain('12 open');
		expect(stats[2]?.hint).toContain('+23%');
	});

	it('maps aging, trend, pipeline, and chase attention', () => {
		const summary = sampleSummary();
		expect(dashboardAgingFromSummary(summary)[1]?.label).toBe('1–30 days');
		expect(dashboardTrendFromSummary(summary)[0]?.label).toBe('Mar');
		expect(dashboardPipelineFromSummary(summary)[1]?.count).toBe(2);
		const attention = dashboardAttentionFromSummary(summary);
		expect(attention[0]?.href).toBe('/invoices/inv-1');
		expect(attention[1]?.href).toBe('/quotes/q-1');
		expect(dashboardCurrencyHint(summary)).toContain('other currencies');
	});
});

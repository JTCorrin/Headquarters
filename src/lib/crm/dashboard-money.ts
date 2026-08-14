import type { ApiDashboardSummary } from '$lib/api/v1/types.js';
import type { AgingBar } from '$lib/components/crm/dashboard-aging-chart.svelte';
import type { PipelineBar } from '$lib/components/crm/dashboard-pipeline-chart.svelte';
import type { TrendPoint } from '$lib/components/crm/dashboard-trend-chart.svelte';
import type {
	DashboardAttentionItem,
	DashboardStat
} from '$lib/components/crm/dashboard-page.svelte';

export function formatDashboardMoney(cents: number, currency: string): string {
	try {
		return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(cents / 100);
	} catch {
		return `${(cents / 100).toFixed(2)} ${currency}`;
	}
}

function deltaHint(current: number, prior: number): string {
	const delta = current - prior;
	if (prior === 0 && current === 0) return 'Last 30 days';
	if (prior === 0) return 'vs prior 30d · new';
	const pct = Math.round((delta / prior) * 100);
	const sign = pct > 0 ? '+' : '';
	return `vs prior 30d · ${sign}${pct}%`;
}

const AGING_LABELS: Record<string, string> = {
	current: 'Current',
	'1_30': '1–30 days',
	'31_60': '31–60 days',
	'61_90': '61–90 days',
	'90_plus': '90+ days'
};

const PIPELINE_LABELS: Record<string, string> = {
	draft: 'Draft',
	sent: 'Sent',
	accepted: 'Accepted',
	rejected: 'Rejected'
};

export function dashboardStatsFromSummary(summary: ApiDashboardSummary): DashboardStat[] {
	const { currency, kpis } = summary;
	return [
		{
			label: 'Outstanding AR',
			value: formatDashboardMoney(kpis.outstanding_cents, currency),
			hint: `${kpis.open_invoice_count} open · ${kpis.overdue_invoice_count} overdue`
		},
		{
			label: 'Overdue AR',
			value: formatDashboardMoney(kpis.overdue_cents, currency),
			hint: kpis.overdue_invoice_count
				? `${kpis.overdue_invoice_count} need chasing`
				: 'None past due'
		},
		{
			label: 'Cash collected (30d)',
			value: formatDashboardMoney(kpis.cash_collected_30d_cents, currency),
			hint: deltaHint(kpis.cash_collected_30d_cents, kpis.cash_collected_prior_30d_cents)
		},
		{
			label: 'Booked (30d)',
			value: formatDashboardMoney(kpis.booked_30d_cents, currency),
			hint: deltaHint(kpis.booked_30d_cents, kpis.booked_prior_30d_cents)
		}
	];
}

export function dashboardAgingFromSummary(summary: ApiDashboardSummary): AgingBar[] {
	return summary.aging.map((row) => ({
		label: AGING_LABELS[row.bucket] ?? row.bucket,
		cents: row.cents,
		count: row.count,
		display: formatDashboardMoney(row.cents, summary.currency)
	}));
}

export function dashboardTrendFromSummary(summary: ApiDashboardSummary): TrendPoint[] {
	return summary.monthly.map((row) => {
		const [, month] = row.month.split('-');
		const monthIndex = Number(month);
		const label =
			Number.isFinite(monthIndex) && monthIndex >= 1 && monthIndex <= 12
				? new Date(Date.UTC(2000, monthIndex - 1, 1)).toLocaleString('en-GB', {
						month: 'short',
						timeZone: 'UTC'
					})
				: row.month;
		return {
			label,
			cashCents: row.cash_cents,
			bookedCents: row.booked_cents
		};
	});
}

export function dashboardPipelineFromSummary(summary: ApiDashboardSummary): PipelineBar[] {
	return summary.quote_pipeline.map((row) => ({
		label: PIPELINE_LABELS[row.status] ?? row.status,
		count: row.count,
		display: formatDashboardMoney(row.total_cents, summary.currency)
	}));
}

export function dashboardAttentionFromSummary(
	summary: ApiDashboardSummary
): DashboardAttentionItem[] {
	const { currency, chase } = summary;
	const items: DashboardAttentionItem[] = [];

	for (const row of chase.overdue_invoices) {
		items.push({
			id: `inv-overdue-${row.id}`,
			label: `${row.number} overdue`,
			detail: `${row.client_name} · ${formatDashboardMoney(row.amount_cents, currency)} · ${row.days}d`,
			href: `/invoices/${row.id}`,
			tone: 'warn',
			badge: 'Overdue'
		});
	}

	for (const row of chase.due_soon_invoices) {
		items.push({
			id: `inv-due-${row.id}`,
			label: `${row.number} due soon`,
			detail: `${row.client_name} · ${formatDashboardMoney(row.amount_cents, currency)} · ${row.days}d`,
			href: `/invoices/${row.id}`,
			badge: 'Due soon'
		});
	}

	for (const row of chase.awaiting_quotes) {
		items.push({
			id: `quote-await-${row.id}`,
			label: `${row.number} awaiting reply`,
			detail: `${row.client_name} · ${formatDashboardMoney(row.amount_cents, currency)} · sent ${row.days}d ago`,
			href: `/quotes/${row.id}`,
			badge: 'Awaiting'
		});
	}

	for (const row of chase.expiring_quotes) {
		items.push({
			id: `quote-expire-${row.id}`,
			label: `${row.number} expiring soon`,
			detail: `${row.client_name} · ${formatDashboardMoney(row.amount_cents, currency)} · ${row.days}d left`,
			href: `/quotes/${row.id}`,
			tone: 'warn',
			badge: 'Expiring'
		});
	}

	return items.slice(0, 8);
}

export function dashboardCurrencyHint(summary: ApiDashboardSummary): string | null {
	if (summary.other_currency_doc_count <= 0) return null;
	return `Totals in ${summary.currency}. ${summary.other_currency_doc_count} documents in other currencies are excluded.`;
}

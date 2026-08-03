import type { ApiV1Client } from '$lib/api/v1/client.js';
import {
	invoiceStatusLabel,
	paymentMethodLabel,
	paymentStatusLabel,
	quoteStatusLabel
} from '$lib/api/v1/mappers.js';
import type { ApiInvoice, ApiPayment, ApiQuote } from '$lib/api/v1/types.js';
import type { MoneySummaryItem } from '$lib/components/crm/money-summary.svelte';

function formatMoney(cents: number, currency: string): string {
	try {
		return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(cents / 100);
	} catch {
		return `${(cents / 100).toFixed(2)} ${currency}`;
	}
}

function formatShortDate(isoDate: string): string {
	const date = new Date(`${isoDate}T00:00:00Z`);
	if (Number.isNaN(date.getTime())) return isoDate;
	return date.toLocaleDateString('en-GB', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function quoteLabel(quote: ApiQuote): string {
	const title = quote.title?.trim();
	return title ? `${quote.number} · ${title}` : quote.number;
}

function paymentLabel(payment: ApiPayment): string {
	const method = paymentMethodLabel(payment.method);
	const ref = payment.reference?.trim();
	return ref ? `${method} · ${ref}` : method;
}

export function toMoneySummaryItemFromQuote(quote: ApiQuote): MoneySummaryItem & { sortKey: string } {
	return {
		id: quote.id,
		kind: 'quote',
		label: quoteLabel(quote),
		amount: formatMoney(quote.total_cents, quote.currency),
		status: quoteStatusLabel(quote.status),
		date: formatShortDate(quote.issue_on),
		href: `/quotes/${quote.id}`,
		sortKey: quote.issue_on || quote.created_at
	};
}

export function toMoneySummaryItemFromInvoice(
	invoice: ApiInvoice
): MoneySummaryItem & { sortKey: string } {
	return {
		id: invoice.id,
		kind: 'invoice',
		label: invoice.number,
		amount: formatMoney(invoice.total_cents, invoice.currency),
		status: invoiceStatusLabel(invoice.status),
		date: formatShortDate(invoice.issue_on),
		href: `/invoices/${invoice.id}`,
		sortKey: invoice.issue_on || invoice.created_at
	};
}

export function toMoneySummaryItemFromPayment(
	payment: ApiPayment
): MoneySummaryItem & { sortKey: string } {
	return {
		id: payment.id,
		kind: 'payment',
		label: paymentLabel(payment),
		amount: formatMoney(payment.amount_cents, payment.currency),
		status: paymentStatusLabel(payment.status),
		date: formatShortDate(payment.occurred_on),
		// No `/payments/:id` route yet — leave payment rows non-linked per slice.
		sortKey: payment.occurred_on || payment.created_at
	};
}

/** Newest first across quotes, invoices, and payments. */
export function mergeClientMoneyItems(
	quotes: ApiQuote[],
	invoices: ApiInvoice[],
	payments: ApiPayment[]
): MoneySummaryItem[] {
	return [
		...quotes.map(toMoneySummaryItemFromQuote),
		...invoices.map(toMoneySummaryItemFromInvoice),
		...payments.map(toMoneySummaryItemFromPayment)
	]
		.sort((a, b) => b.sortKey.localeCompare(a.sortKey))
		.map(({ sortKey: _sortKey, ...item }) => item);
}

/**
 * Load Client Money tab snapshot via three list calls.
 * Soft-fails each list independently so the profile still renders.
 */
export async function loadClientMoneyItems(
	api: ApiV1Client,
	clientId: string,
	signal?: AbortSignal
): Promise<MoneySummaryItem[]> {
	const [quotesResult, invoicesResult, paymentsResult] = await Promise.allSettled([
		api.quotes.list({ client_id: clientId, limit: 50 }, signal),
		api.invoices.list({ client_id: clientId, limit: 50 }, signal),
		api.payments.list({ client_id: clientId, direction: 'inbound', limit: 50 }, signal)
	]);

	const quotes = quotesResult.status === 'fulfilled' ? quotesResult.value.data : [];
	const invoices = invoicesResult.status === 'fulfilled' ? invoicesResult.value.data : [];
	const payments = paymentsResult.status === 'fulfilled' ? paymentsResult.value.data : [];
	return mergeClientMoneyItems(quotes, invoices, payments);
}

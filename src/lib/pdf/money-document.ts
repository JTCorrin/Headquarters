import type { TDocumentDefinitions, Content } from 'pdfmake/interfaces';
import type { LineItemRow } from '$lib/components/crm/line-items-table.svelte';

export type MoneyDocumentKind = 'quote' | 'invoice' | 'bill';

/** Server-authoritative money totals in minor units. */
export interface MoneyDocumentTotals {
	subtotalCents: number;
	discountCents: number;
	taxCents: number;
	totalCents: number;
}

export interface MoneyDocumentInput {
	kind: MoneyDocumentKind;
	orgName: string;
	/** Data URL for pdfmake image embedding. */
	orgLogoDataUrl?: string;
	/** Preformatted letterhead lines (name, address, contact, tax). */
	orgAddressLines?: string[];
	partyLabel: string;
	partyName: string;
	/** Optional Attn line under the party name (billing + other recipients). */
	attentionLine?: string;
	documentNumber: string;
	subtitle?: string;
	currency: string;
	status: string;
	dueOn?: string;
	issueDate?: string;
	lines: LineItemRow[];
	notes?: string;
	/** When set, summary uses these instead of recomputing from lines (quote/invoice/bill). */
	totals?: MoneyDocumentTotals;
}

const KIND_LABEL: Record<MoneyDocumentKind, string> = {
	quote: 'QUOTE',
	invoice: 'INVOICE',
	bill: 'BILL'
};

const CURRENCY_SYMBOL: Record<string, string> = {
	GBP: '£',
	USD: '$',
	EUR: '€'
};

function money(amount: number, currency: string): string {
	const symbol = CURRENCY_SYMBOL[currency] ?? `${currency} `;
	return `${symbol}${amount.toFixed(2)}`;
}

function lineTotal(row: LineItemRow): number {
	const qty = Number(row.qty) || 0;
	const unit = Number(row.unitPrice) || 0;
	if (row.total) {
		const parsed = Number(row.total);
		if (!Number.isNaN(parsed)) return parsed;
	}
	return qty * unit;
}

export function buildMoneyDocumentDef(input: MoneyDocumentInput): TDocumentDefinitions {
	const {
		kind,
		orgName,
		orgLogoDataUrl,
		orgAddressLines = [],
		partyLabel,
		partyName,
		attentionLine,
		documentNumber,
		subtitle,
		currency,
		status,
		dueOn,
		issueDate,
		lines,
		notes,
		totals
	} = input;

	const computedSubtotal = lines.reduce((sum, row) => sum + lineTotal(row), 0);
	const summarySubtotal = totals ? totals.subtotalCents / 100 : computedSubtotal;
	const summaryDiscount = totals ? totals.discountCents / 100 : 0;
	const summaryTax = totals ? totals.taxCents / 100 : 0;
	const summaryTotal = totals ? totals.totalCents / 100 : computedSubtotal;
	const tableBody: Content[][] = [
		[
			{ text: 'Description', style: 'tableHeader' },
			{ text: 'Qty', style: 'tableHeader', alignment: 'right' },
			{ text: 'Unit', style: 'tableHeader', alignment: 'right' },
			{ text: 'Total', style: 'tableHeader', alignment: 'right' }
		],
		...lines.map((row) => [
			{
				text: row.productSku ? `${row.description}\nSKU ${row.productSku}` : row.description,
				style: 'tableCell'
			},
			{ text: row.qty, style: 'tableCell', alignment: 'right' },
			{ text: money(Number(row.unitPrice) || 0, currency), style: 'tableCell', alignment: 'right' },
			{ text: money(lineTotal(row), currency), style: 'tableCell', alignment: 'right' }
		])
	];

	if (lines.length === 0) {
		tableBody.push([
			{ text: 'No line items yet', colSpan: 4, style: 'muted', italics: true },
			{},
			{},
			{}
		]);
	}

	const leftBrand: Content[] = orgLogoDataUrl
		? [{ image: 'orgLogo', width: 120, margin: [0, 0, 0, 4] }]
		: [{ text: orgName, style: 'org' }];

	const rightAddress: Content[] =
		orgAddressLines.length > 0
			? orgAddressLines.map((line, index) => ({
					text: line,
					style: index === 0 ? 'org' : 'addressLine',
					alignment: 'right' as const,
					margin: index === 0 ? ([0, 0, 0, 2] as [number, number, number, number]) : undefined
				}))
			: [{ text: orgName, style: 'org', alignment: 'right' }];

	const doc: TDocumentDefinitions = {
		pageSize: 'A4',
		pageMargins: [48, 48, 48, 56],
		content: [
			{
				columns: [
					{ width: '*', stack: leftBrand },
					{
						width: 'auto',
						alignment: 'right',
						stack: rightAddress
					}
				]
			},
			{
				columns: [
					[{ text: KIND_LABEL[kind], style: 'docKind', margin: [0, 16, 0, 0] }],
					{
						width: 'auto',
						alignment: 'right',
						stack: [
							{ text: documentNumber || '—', style: 'docNumber', margin: [0, 16, 0, 0] },
							{ text: status.toUpperCase(), style: 'status', margin: [0, 4, 0, 0] }
						]
					}
				]
			},
			{
				columns: [
					{
						width: '*',
						stack: [
							{ text: partyLabel, style: 'label', margin: [0, 28, 0, 4] },
							{ text: partyName || '—', style: 'party' },
							...(attentionLine
								? [{ text: attentionLine, style: 'muted', margin: [0, 2, 0, 0] }]
								: []),
							...(subtitle ? [{ text: subtitle, style: 'muted', margin: [0, 2, 0, 0] }] : [])
						]
					},
					{
						width: 'auto',
						alignment: 'right',
						stack: [
							{ text: 'Issued', style: 'label', margin: [0, 28, 0, 4] },
							{ text: issueDate || '—', style: 'meta' },
							...(dueOn
								? [
										{ text: 'Due', style: 'label', margin: [0, 10, 0, 4] },
										{ text: dueOn, style: 'meta' }
									]
								: [])
						]
					}
				]
			},
			{
				table: {
					headerRows: 1,
					widths: ['*', 48, 72, 72],
					body: tableBody
				},
				layout: {
					fillColor: (rowIndex: number) => (rowIndex === 0 ? '#f4f4f5' : null),
					hLineColor: () => '#e4e4e7',
					vLineColor: () => '#e4e4e7',
					paddingLeft: () => 8,
					paddingRight: () => 8,
					paddingTop: () => 7,
					paddingBottom: () => 7
				},
				margin: [0, 28, 0, 16]
			},
			{
				columns: [
					{ width: '*', text: '' },
					{
						width: 180,
						stack: [
							{
								columns: [
									{ text: 'Subtotal', style: 'muted' },
									{
										text: money(summarySubtotal, currency),
										alignment: 'right',
										style: 'meta'
									}
								]
							},
							...(summaryDiscount > 0
								? [
										{
											columns: [
												{ text: 'Discount', style: 'muted', margin: [0, 4, 0, 0] },
												{
													text: `−${money(summaryDiscount, currency)}`,
													alignment: 'right' as const,
													style: 'meta',
													margin: [0, 4, 0, 0]
												}
											]
										}
									]
								: []),
							...(summaryTax > 0
								? [
										{
											columns: [
												{ text: 'Tax', style: 'muted', margin: [0, 4, 0, 0] },
												{
													text: money(summaryTax, currency),
													alignment: 'right' as const,
													style: 'meta',
													margin: [0, 4, 0, 0]
												}
											]
										}
									]
								: []),
							{
								columns: [
									{ text: 'Total', style: 'totalLabel', margin: [0, 8, 0, 0] },
									{
										text: money(summaryTotal, currency),
										alignment: 'right',
										style: 'totalValue',
										margin: [0, 8, 0, 0]
									}
								]
							}
						]
					}
				]
			},
			...(notes
				? [
						{ text: 'Notes', style: 'label', margin: [0, 28, 0, 4] },
						{ text: notes, style: 'muted' }
					]
				: [
						{
							text: 'Live preview — edits to the form and lines update this document.',
							style: 'muted',
							margin: [0, 28, 0, 0]
						}
					])
		],
		styles: {
			org: { fontSize: 12, bold: true, color: '#18181b' },
			addressLine: { fontSize: 9, color: '#52525b' },
			docKind: { fontSize: 22, bold: true, color: '#18181b', characterSpacing: 1 },
			docNumber: { fontSize: 12, bold: true, color: '#18181b' },
			status: { fontSize: 9, color: '#71717a', bold: true, characterSpacing: 0.5 },
			label: { fontSize: 9, color: '#71717a', bold: true, characterSpacing: 0.4 },
			party: { fontSize: 12, bold: true, color: '#18181b' },
			meta: { fontSize: 10, color: '#27272a' },
			muted: { fontSize: 9, color: '#71717a' },
			tableHeader: { fontSize: 9, bold: true, color: '#3f3f46' },
			tableCell: { fontSize: 9, color: '#27272a' },
			totalLabel: { fontSize: 11, bold: true, color: '#18181b' },
			totalValue: { fontSize: 14, bold: true, color: '#18181b' }
		},
		defaultStyle: {
			font: 'Roboto',
			fontSize: 10,
			color: '#27272a'
		}
	};

	if (orgLogoDataUrl) {
		doc.images = { orgLogo: orgLogoDataUrl };
	}

	return doc;
}

export function moneyDocumentFilename(input: MoneyDocumentInput): string {
	const base = (input.documentNumber || input.kind).replace(/[^\w.-]+/g, '_');
	return `${base}.pdf`;
}

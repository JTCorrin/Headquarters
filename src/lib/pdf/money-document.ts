import type { TDocumentDefinitions, Content } from 'pdfmake/interfaces';
import type { LineItemRow } from '$lib/components/crm/line-items-table.svelte';

export type MoneyDocumentKind = 'quote' | 'invoice' | 'bill';

export interface MoneyDocumentInput {
	kind: MoneyDocumentKind;
	orgName: string;
	partyLabel: string;
	partyName: string;
	documentNumber: string;
	subtitle?: string;
	currency: string;
	status: string;
	dueOn?: string;
	issueDate?: string;
	lines: LineItemRow[];
	notes?: string;
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
		partyLabel,
		partyName,
		documentNumber,
		subtitle,
		currency,
		status,
		dueOn,
		issueDate,
		lines,
		notes
	} = input;

	const subtotal = lines.reduce((sum, row) => sum + lineTotal(row), 0);
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

	return {
		pageSize: 'A4',
		pageMargins: [48, 48, 48, 56],
		content: [
			{
				columns: [
					[
						{ text: orgName, style: 'org' },
						{ text: KIND_LABEL[kind], style: 'docKind', margin: [0, 8, 0, 0] }
					],
					{
						width: 'auto',
						alignment: 'right',
						stack: [
							{ text: documentNumber || '—', style: 'docNumber' },
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
									{ text: money(subtotal, currency), alignment: 'right', style: 'meta' }
								]
							},
							{
								columns: [
									{ text: 'Total', style: 'totalLabel', margin: [0, 8, 0, 0] },
									{
										text: money(subtotal, currency),
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
}

export function moneyDocumentFilename(input: MoneyDocumentInput): string {
	const base = (input.documentNumber || input.kind).replace(/[^\w.-]+/g, '_');
	return `${base}.pdf`;
}

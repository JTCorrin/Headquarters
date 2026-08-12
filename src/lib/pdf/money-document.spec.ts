import { describe, expect, it } from 'vitest';
import { buildMoneyDocumentDef } from './money-document.js';

describe('buildMoneyDocumentDef', () => {
	it('uses server-authoritative totals when provided', () => {
		const def = buildMoneyDocumentDef({
			kind: 'invoice',
			orgName: 'Corrin',
			partyLabel: 'Bill to',
			partyName: 'Northwind',
			documentNumber: 'INV-0001',
			currency: 'GBP',
			status: 'draft',
			lines: [
				{
					id: 'line-1',
					description: 'Retainer',
					qty: '1',
					unitPrice: '100.00',
					total: '100.00'
				}
			],
			totals: {
				subtotalCents: 10000,
				discountCents: 1000,
				taxCents: 1800,
				totalCents: 10800
			}
		});

		const content = JSON.stringify(def.content);
		expect(content).toContain('Subtotal');
		expect(content).toContain('Discount');
		expect(content).toContain('Tax');
		expect(content).toContain('£108.00');
		expect(content).toContain('£100.00');
		expect(content).toContain('£10.00');
		expect(content).toContain('£18.00');
	});

	it('renders Attn line under Bill to when attentionLine is set', () => {
		const def = buildMoneyDocumentDef({
			kind: 'invoice',
			orgName: 'Corrin',
			partyLabel: 'Bill to',
			partyName: 'Northwind',
			attentionLine: 'Attn: Ada Billing; Bob Ops',
			documentNumber: 'INV-0002',
			currency: 'GBP',
			status: 'draft',
			lines: []
		});

		const content = JSON.stringify(def.content);
		expect(content).toContain('Attn: Ada Billing; Bob Ops');
		expect(content).toContain('Northwind');
	});

	it('shows Tax on quote PDFs when server totals include tax_cents', () => {
		const def = buildMoneyDocumentDef({
			kind: 'quote',
			orgName: 'Corrin',
			partyLabel: 'Bill to',
			partyName: 'Northwind',
			documentNumber: 'Q-0001',
			subtitle: 'Q2 retainer',
			currency: 'GBP',
			status: 'draft',
			lines: [
				{
					id: 'line-1',
					description: 'Retainer',
					qty: '1',
					unitPrice: '100.00',
					total: '100.00'
				}
			],
			totals: {
				subtotalCents: 10000,
				discountCents: 0,
				taxCents: 2000,
				totalCents: 12000
			}
		});

		const content = JSON.stringify(def.content);
		expect(content).toContain('Tax');
		expect(content).toContain('£20.00');
		expect(content).toContain('£120.00');
	});

	it('places logo left and address right when branding is provided', () => {
		const def = buildMoneyDocumentDef({
			kind: 'invoice',
			orgName: 'Corrin',
			orgLogoDataUrl: 'data:image/png;base64,aaa',
			orgAddressLines: ['Corrin Data Ltd', '12 Harbour Rd', 'London, E1 6AN'],
			partyLabel: 'Bill to',
			partyName: 'Northwind',
			documentNumber: 'INV-0003',
			currency: 'GBP',
			status: 'draft',
			lines: []
		});

		const content = JSON.stringify(def.content);
		expect(def.images).toEqual({ orgLogo: 'data:image/png;base64,aaa' });
		expect(content).toContain('orgLogo');
		expect(content).toContain('Corrin Data Ltd');
		expect(content).toContain('12 Harbour Rd');
		expect(content).toContain('INVOICE');
		expect(content).toContain('INV-0003');
	});

	it('falls back to org name text when logo is missing', () => {
		const def = buildMoneyDocumentDef({
			kind: 'quote',
			orgName: 'Corrin Data',
			orgAddressLines: [],
			partyLabel: 'Bill to',
			partyName: 'Northwind',
			documentNumber: 'Q-0002',
			currency: 'GBP',
			status: 'draft',
			lines: []
		});

		const content = JSON.stringify(def.content);
		expect(def.images).toBeUndefined();
		expect(content).toContain('Corrin Data');
		expect(content).toContain('QUOTE');
	});
});

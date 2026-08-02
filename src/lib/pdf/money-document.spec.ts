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
});

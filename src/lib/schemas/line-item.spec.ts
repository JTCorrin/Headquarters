import { describe, expect, it } from 'vitest';
import { defaultTaxRatePercentString } from './line-item.js';

describe('defaultTaxRatePercentString', () => {
	const rates = [
		{ rate_percent: 20, is_default: true, active: true },
		{ rate_percent: 5, is_default: false, active: true }
	];

	it('uses the org default rate', () => {
		expect(defaultTaxRatePercentString(rates)).toBe('20');
	});

	it('returns 0 when the client is VAT exempt', () => {
		expect(defaultTaxRatePercentString(rates, { taxExempt: true })).toBe('0');
	});
});

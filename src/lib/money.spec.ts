import { describe, expect, it } from 'vitest';
import {
	amountStringToCents,
	centsToAmountString,
	computeBoardPosition,
	isValidAmountString,
	resolveLeadCurrency
} from './money.js';

describe('money helpers', () => {
	it('converts cents ↔ decimal strings', () => {
		expect(centsToAmountString(1800000)).toBe('18000');
		expect(centsToAmountString(199)).toBe('1.99');
		expect(centsToAmountString(null)).toBe('');
		expect(amountStringToCents('18000')).toBe(1_800_000);
		expect(amountStringToCents('1.99')).toBe(199);
		expect(amountStringToCents('')).toBeNull();
		expect(amountStringToCents('1,800.50')).toBe(180050);
	});

	it('rejects invalid amount strings', () => {
		expect(isValidAmountString('12.345')).toBe(false);
		expect(isValidAmountString('-1')).toBe(false);
		expect(isValidAmountString('abc')).toBe(false);
		expect(isValidAmountString('12.3')).toBe(true);
	});

	it('resolves currency from client then org', () => {
		expect(resolveLeadCurrency({ clientCurrency: 'USD', orgCurrency: 'EUR' })).toBe('USD');
		expect(resolveLeadCurrency({ clientCurrency: null, orgCurrency: 'EUR' })).toBe('EUR');
		expect(resolveLeadCurrency({ clientCurrency: '', orgCurrency: null })).toBe('GBP');
	});

	it('computes board insert positions', () => {
		const column = [
			{ id: 'a', position: 0 },
			{ id: 'b', position: 1000 },
			{ id: 'c', position: 2000 }
		];
		expect(computeBoardPosition(column, 'a', 'x')).toBe(-1000);
		expect(computeBoardPosition(column, 'b', 'x')).toBe(500);
		expect(computeBoardPosition(column, null, 'x')).toBe(3000);
		expect(computeBoardPosition([], null, 'x')).toBe(0);
	});
});

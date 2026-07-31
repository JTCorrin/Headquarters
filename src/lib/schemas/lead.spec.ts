import { describe, expect, it } from 'vitest';
import { convertLeadFormSchema, leadFormSchema } from './lead.js';

describe('leadFormSchema', () => {
	it('accepts a valid open-stage lead', () => {
		const parsed = leadFormSchema.safeParse({
			name: 'Contoso expansion',
			companyName: 'Contoso',
			stage: 'proposal',
			valueCents: '1800000',
			currency: 'GBP',
			probabilityPercent: '60.5',
			source: 'Referral',
			expectedCloseOn: '2026-08-15',
			lostReason: '',
			notes: ''
		});
		expect(parsed.success).toBe(true);
	});

	it('requires lostReason when stage is lost', () => {
		const parsed = leadFormSchema.safeParse({
			name: 'Lost deal',
			stage: 'lost',
			currency: 'GBP',
			lostReason: ''
		});
		expect(parsed.success).toBe(false);
		if (!parsed.success) {
			expect(parsed.error.issues.some((i) => i.path.includes('lostReason'))).toBe(true);
		}
	});

	it('rejects unsafe valueCents', () => {
		const parsed = leadFormSchema.safeParse({
			name: 'Overflow',
			stage: 'new',
			currency: 'GBP',
			valueCents: '12.5'
		});
		expect(parsed.success).toBe(false);
	});

	it('rejects impossible dates', () => {
		const parsed = leadFormSchema.safeParse({
			name: 'Bad date',
			stage: 'new',
			currency: 'GBP',
			expectedCloseOn: '2026-02-30'
		});
		expect(parsed.success).toBe(false);
	});
});

describe('convertLeadFormSchema', () => {
	it('accepts optional client name with status', () => {
		const parsed = convertLeadFormSchema.safeParse({
			clientName: 'Contoso Ltd',
			clientStatus: 'active'
		});
		expect(parsed.success).toBe(true);
	});
});

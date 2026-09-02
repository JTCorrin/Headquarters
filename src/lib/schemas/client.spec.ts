import { describe, expect, it } from 'vitest';
import { clientFormSchema } from './client.js';

describe('clientFormSchema invoicingEmail', () => {
	const base = {
		name: 'Northwind',
		status: 'active' as const,
		websiteUrl: '',
		industry: '',
		primaryEmail: '',
		emailDomain: '',
		phone: '',
		taxIdentifier: '',
		taxExempt: false,
		registrationNumber: '',
		defaultCurrency: 'GBP',
		paymentTermsDays: '',
		renewalOn: '',
		notes: ''
	};

	it('accepts empty invoicing email', () => {
		expect(clientFormSchema.safeParse({ ...base, invoicingEmail: '' }).success).toBe(true);
	});

	it('accepts a valid invoicing email', () => {
		expect(
			clientFormSchema.safeParse({ ...base, invoicingEmail: 'accounts@northwind.com' }).success
		).toBe(true);
	});

	it('rejects an invalid invoicing email', () => {
		const result = clientFormSchema.safeParse({ ...base, invoicingEmail: 'not-an-email' });
		expect(result.success).toBe(false);
	});
});

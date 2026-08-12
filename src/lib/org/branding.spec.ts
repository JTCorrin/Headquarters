import { describe, expect, it } from 'vitest';
import { formatOrgLetterheadLines } from './branding.js';

describe('formatOrgLetterheadLines', () => {
	it('builds Invoice Ninja–style letterhead lines', () => {
		const lines = formatOrgLetterheadLines({
			name: 'Corrin Data',
			legal_name: 'Corrin Data Ltd',
			address_line1: '12 Harbour Rd',
			address_line2: 'Suite 4',
			city: 'London',
			region: 'Greater London',
			postal_code: 'E1 6AN',
			country_code: 'GB',
			phone: '+44 20 0000 0000',
			billing_email: 'billing@corrin.test',
			website_url: 'https://corrin.test',
			tax_identifier: 'GB123',
			registration_number: '09876543'
		});

		expect(lines).toEqual([
			'Corrin Data Ltd',
			'12 Harbour Rd',
			'Suite 4',
			'London, Greater London, E1 6AN',
			'United Kingdom',
			'+44 20 0000 0000',
			'billing@corrin.test',
			'https://corrin.test',
			'Tax ID GB123',
			'Reg 09876543'
		]);
	});

	it('falls back to display name when legal name is empty', () => {
		const lines = formatOrgLetterheadLines({
			name: 'Corrin Data',
			legal_name: null,
			address_line1: null,
			address_line2: null,
			city: null,
			region: null,
			postal_code: null,
			country_code: 'GB',
			phone: null,
			billing_email: null,
			website_url: null,
			tax_identifier: null,
			registration_number: null
		});

		expect(lines[0]).toBe('Corrin Data');
		expect(lines).toContain('United Kingdom');
	});
});

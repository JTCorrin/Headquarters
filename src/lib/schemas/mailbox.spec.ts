import { describe, expect, it } from 'vitest';
import {
	applyMailboxPreset,
	emptyMailboxFormData,
	mailboxFormSchema,
	mailboxPresetDefaults,
	mailboxSecurityOptions
} from './mailbox.js';

describe('mailbox schema', () => {
	it('wires security as tls | starttls | none (API/DB enum)', () => {
		expect(mailboxSecurityOptions).toEqual(['tls', 'starttls', 'none']);
		expect(mailboxPresetDefaults.gmail.imapSecurity).toBe('tls');
		expect(mailboxPresetDefaults.gmail.smtpSecurity).toBe('tls');
		expect(mailboxPresetDefaults.custom.imapSecurity).toBe('tls');
		expect(mailboxPresetDefaults.outlook.imapSecurity).toBe('tls');
		expect(mailboxPresetDefaults.outlook.smtpSecurity).toBe('starttls');
	});

	it('accepts a gmail-shaped form with password', () => {
		const data = {
			...emptyMailboxFormData('gmail'),
			emailAddress: 'joe@acme.test',
			username: 'joe@acme.test',
			password: 'app-password',
			fromName: 'Joe'
		};
		expect(mailboxFormSchema.safeParse(data).success).toBe(true);
		expect(data.imapSecurity).toBe('tls');
		expect(data.smtpSecurity).toBe('tls');
	});

	it('applies outlook host defaults from preset', () => {
		const next = applyMailboxPreset(emptyMailboxFormData('custom'), 'outlook');
		expect(next.imapHost).toBe('outlook.office365.com');
		expect(next.smtpPort).toBe('587');
		expect(next.smtpSecurity).toBe('starttls');
	});

	it('rejects legacy ssl wire value', () => {
		const data = {
			...emptyMailboxFormData('gmail'),
			emailAddress: 'joe@acme.test',
			imapSecurity: 'ssl',
			smtpSecurity: 'ssl'
		} as unknown as Parameters<typeof mailboxFormSchema.safeParse>[0];
		expect(mailboxFormSchema.safeParse(data).success).toBe(false);
	});

	it('rejects invalid ports', () => {
		const data = {
			...emptyMailboxFormData('custom'),
			emailAddress: 'joe@acme.test',
			imapHost: 'mail.example.com',
			smtpHost: 'mail.example.com',
			imapPort: '99999',
			smtpPort: '465'
		};
		expect(mailboxFormSchema.safeParse(data).success).toBe(false);
	});
});

import { describe, expect, it } from 'vitest';
import {
	applyMailboxPreset,
	emptyMailboxFormData,
	mailboxFormSchema
} from './mailbox.js';

describe('mailbox schema', () => {
	it('accepts a gmail-shaped form with password', () => {
		const data = {
			...emptyMailboxFormData('gmail'),
			emailAddress: 'joe@acme.test',
			username: 'joe@acme.test',
			password: 'app-password',
			fromName: 'Joe'
		};
		expect(mailboxFormSchema.safeParse(data).success).toBe(true);
	});

	it('applies outlook host defaults from preset', () => {
		const next = applyMailboxPreset(emptyMailboxFormData('custom'), 'outlook');
		expect(next.imapHost).toBe('outlook.office365.com');
		expect(next.smtpPort).toBe('587');
		expect(next.smtpSecurity).toBe('starttls');
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

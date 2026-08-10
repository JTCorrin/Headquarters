import { describe, expect, it } from 'vitest';
import type { ApiMailboxAccount } from '$lib/api/v1/types.js';
import { isMailboxOutboundReady } from './mailbox-outbound.js';

function mailbox(partial: Partial<ApiMailboxAccount>): ApiMailboxAccount {
	return {
		id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
		email_address: 'owner@example.test',
		username: 'owner@example.test',
		from_name: null,
		imap_host: 'imap.example.test',
		imap_port: 993,
		imap_security: 'tls',
		smtp_host: 'smtp.example.test',
		smtp_port: 587,
		smtp_security: 'starttls',
		credentials_configured: true,
		status: 'ok',
		last_checked_at: null,
		last_error_code: null,
		...partial
	};
}

describe('isMailboxOutboundReady', () => {
	it('requires configured credentials and SMTP fields', () => {
		expect(isMailboxOutboundReady(mailbox({}))).toBe(true);
		expect(isMailboxOutboundReady(null)).toBe(false);
		expect(isMailboxOutboundReady(mailbox({ credentials_configured: false }))).toBe(false);
		expect(isMailboxOutboundReady(mailbox({ smtp_host: '' }))).toBe(false);
		expect(isMailboxOutboundReady(mailbox({ smtp_port: 0 }))).toBe(false);
	});
});

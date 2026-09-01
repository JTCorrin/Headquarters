import { describe, expect, it } from 'vitest';
import {
	applyMailboxPreset,
	describeMailboxSyncResult,
	emptyMailboxFormData,
	humanizeMailboxSyncError,
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
		expect(next.smtpHost).toBe('smtp-mail.outlook.com');
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

	it('humanizes timeout distinctly from connection_failed', () => {
		expect(humanizeMailboxSyncError('timeout')).toMatch(/timed out/i);
		expect(humanizeMailboxSyncError('imap_connection_failed')).toMatch(/Could not reach/i);
		expect(humanizeMailboxSyncError('timeout')).not.toBe(
			humanizeMailboxSyncError('imap_connection_failed')
		);
		expect(humanizeMailboxSyncError('imap_not_configured_for_host')).toMatch(
			/imap_not_configured_for_host/
		);
	});

	it('humanizes lease_held as another sync in progress', () => {
		expect(humanizeMailboxSyncError('lease_held')).toMatch(/already running/i);
		expect(humanizeMailboxSyncError('lease_held')).toBe(
			humanizeMailboxSyncError('not_claimed')
		);
		expect(describeMailboxSyncResult({ ok: false, ingested: 0, error_code: 'lease_held' })).toMatch(
			/already running/i
		);
	});

	it('prefers Sync API timeout message, else includes step', () => {
		expect(
			humanizeMailboxSyncError('timeout', {
				message: 'Mailbox sync timed out during fetch. Try Sync again, or reduce inbox load.',
				step: 'fetch'
			})
		).toBe('Mailbox sync timed out during fetch. Try Sync again, or reduce inbox load.');
		expect(humanizeMailboxSyncError('timeout', { step: 'fetch' })).toMatch(/during fetch/i);
		expect(humanizeMailboxSyncError('timeout', { step: 'search' })).toMatch(/during search/i);
	});

	it('describes sync timeout with step from the API payload', () => {
		expect(
			describeMailboxSyncResult({
				ok: false,
				ingested: 0,
				error_code: 'timeout',
				step: 'fetch',
				message: 'Mailbox sync timed out during fetch. Try Sync again, or reduce inbox load.'
			})
		).toMatch(/during fetch/i);
		expect(
			describeMailboxSyncResult({ ok: false, ingested: 0, error_code: 'timeout', step: 'fetch' })
		).toMatch(/during fetch/i);
		expect(
			describeMailboxSyncResult({ ok: true, ingested: 0, error_code: null })
		).toBe('Sync completed — no new messages.');
		expect(
			describeMailboxSyncResult({
				ok: true,
				ingested: 43,
				error_code: null,
				catchup_complete: false
			})
		).toMatch(/Catch-up continues/i);
		expect(
			describeMailboxSyncResult({ ok: true, ingested: 0, error_code: null, catchup_complete: false })
		).toMatch(/still catching up/i);
	});
});

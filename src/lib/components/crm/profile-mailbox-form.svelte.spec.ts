import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { applyMailboxPreset } from '$lib/schemas/mailbox.js';
import type { MailboxAccountResource } from '$lib/schemas/mailbox.js';
import ProfileMailboxFormTestHost from './profile-mailbox-form.test-host.svelte';

function accountFixture(overrides: Partial<MailboxAccountResource> = {}): MailboxAccountResource {
	return {
		id: 'mailbox-1',
		email_address: 'me@example.test',
		username: 'me@example.test',
		from_name: 'Me',
		imap_host: 'imap.example.test',
		imap_port: 993,
		imap_security: 'tls',
		smtp_host: 'smtp.example.test',
		smtp_port: 587,
		smtp_security: 'starttls',
		credentials_configured: true,
		status: 'ok',
		auth_mode: 'password',
		oauth_provider: null,
		last_checked_at: '2026-08-20T10:00:00Z',
		last_error_code: null,
		syncIntervalMinutes: 5,
		...overrides
	};
}

describe('ProfileMailboxForm', () => {
	it('renders an OAuth connect button for the gmail preset', async () => {
		const onConnectOAuth = vi.fn();
		render(ProfileMailboxFormTestHost, {
			account: accountFixture(),
			onConnectOAuth
		});
		await expect.element(page.getByTestId('mailbox-oauth-connect')).toHaveTextContent(
			/Connect with Google/i
		);
	});

	it('labels Microsoft for the outlook preset', async () => {
		render(ProfileMailboxFormTestHost, {
			account: accountFixture(),
			preset: 'outlook'
		});
		await expect.element(page.getByTestId('mailbox-oauth-connect')).toHaveTextContent(
			/Connect with Microsoft/i
		);
	});

	it('hides password fields for oauth presets', async () => {
		render(ProfileMailboxFormTestHost, { account: accountFixture() });
		await expect
			.element(page.getByTestId('mailbox-password'))
			.not.toBeInTheDocument();
	});

	it('shows connected status for a linked Google mailbox and hides connect', async () => {
		render(ProfileMailboxFormTestHost, {
			account: accountFixture({ auth_mode: 'oauth', oauth_provider: 'google' })
		});
		const status = page.getByTestId('mailbox-oauth-connected');
		await expect.element(status).toHaveTextContent('Connected via Google as me@example.test');
		await expect
			.element(page.getByTestId('mailbox-oauth-connect'))
			.not.toBeInTheDocument();
	});

	it('shows saved-password hint for password mailboxes on custom preset', async () => {
		render(ProfileMailboxFormTestHost, {
			account: accountFixture(),
			preset: 'custom'
		});
		await expect
			.element(page.getByTestId('mailbox-credentials-saved'))
			.toHaveTextContent('Password saved');
		await expect.element(page.getByTestId('mailbox-email')).toBeVisible();
		await expect.element(page.getByTestId('mailbox-submit')).toBeVisible();
	});

	it('surfaces OAuth error text with alert role', async () => {
		render(ProfileMailboxFormTestHost, {
			account: accountFixture(),
			oauthError: 'OAuth failed'
		});
		await expect
			.element(page.getByTestId('mailbox-oauth-error'))
			.toHaveTextContent('OAuth failed');
	});

	it('hides sync interval controls when no save handler is provided', async () => {
		render(ProfileMailboxFormTestHost, { account: accountFixture() });
		await expect
			.element(page.getByTestId('mailbox-sync-interval'))
			.not.toBeInTheDocument();
	});

	it('shows sync interval controls when a save handler is provided', async () => {
		const onSaveSyncInterval = vi.fn().mockResolvedValue(false);
		render(ProfileMailboxFormTestHost, { account: accountFixture(), onSaveSyncInterval });
		await expect.element(page.getByTestId('mailbox-sync-interval')).toBeVisible();
	});

	it('saves a changed sync interval and shows feedback', async () => {
		const onSaveSyncInterval = vi.fn().mockResolvedValue({ ok: true, message: 'Saved' });
		render(ProfileMailboxFormTestHost, { account: accountFixture(), onSaveSyncInterval });
		const saveButton = page.getByTestId('mailbox-sync-interval-save');
		await expect.element(saveButton).toBeDisabled();
		expect(onSaveSyncInterval).not.toHaveBeenCalled();
	});

	it('disables test/sync buttons until credentials exist', async () => {
		const onTest = vi.fn().mockResolvedValue(false);
		const onSync = vi.fn().mockResolvedValue(false);
		render(ProfileMailboxFormTestHost, {
			account: accountFixture({ credentials_configured: false }),
			onTest,
			onSync
		});
		await expect.element(page.getByTestId('mailbox-test')).toBeDisabled();
		await expect.element(page.getByTestId('mailbox-sync')).toBeDisabled();
		expect(onTest).not.toHaveBeenCalled();
		expect(onSync).not.toHaveBeenCalled();
	});

	it('runs test connection and renders ok feedback', async () => {
		const onTest = vi.fn().mockResolvedValue({
			ok: true,
			message: 'Connection succeeded'
		});
		render(ProfileMailboxFormTestHost, { account: accountFixture(), onTest });
		const testButton = page.getByTestId('mailbox-test');
		await expect.element(testButton).toBeEnabled();
		await testButton.click();
		await vi.waitFor(() => {
			expect(onTest).toHaveBeenCalledOnce();
		});
		await expect
			.element(page.getByTestId('mailbox-test-feedback'))
			.toHaveTextContent('Connection succeeded');
	});

	it('reports human-readable sync errors in status line', async () => {
		render(ProfileMailboxFormTestHost, {
			account: accountFixture({ last_error_code: 'imap_auth_failed' })
		});
		await expect
			.element(page.getByTestId('mailbox-sync-status'))
			.toHaveTextContent(/Sign-in failed/);
	});
});

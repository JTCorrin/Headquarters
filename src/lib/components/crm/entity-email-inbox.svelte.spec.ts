import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import EntityEmailInbox from './entity-email-inbox.svelte';
import { sampleEmailMessages } from '../../../stories/crm/story-fixtures.js';

describe('EntityEmailInbox', () => {
	it('shows no-mailbox empty state with Mail settings CTA', async () => {
		render(EntityEmailInbox, {
			messages: [],
			emptyState: 'no_mailbox',
			mailboxConnected: false,
			role: 'owner'
		});

		await expect
			.element(page.getByTestId('entity-email-empty-pane'))
			.toHaveTextContent(/Connect your mailbox/i);
		await expect
			.element(page.getByTestId('entity-email-empty-pane').getByRole('link'))
			.toHaveTextContent(/Mail settings/i);
	});

	it('shows teammate privacy empty state without CTA', async () => {
		render(EntityEmailInbox, {
			messages: [],
			emptyState: 'teammate_nothing_shared',
			role: 'member'
		});

		await expect
			.element(page.getByTestId('entity-email-empty-pane'))
			.toHaveTextContent(/No shared emails yet/);
		await expect
			.element(page.getByTestId('entity-email-empty-pane'))
			.toHaveTextContent(/added to the timeline/i);
	});

	it('shows personal inbox empty state (not entity match copy)', async () => {
		render(EntityEmailInbox, {
			messages: [],
			emptyState: 'empty_inbox',
			mailboxConnected: true,
			role: 'owner'
		});

		await expect
			.element(page.getByTestId('entity-email-empty-pane'))
			.toHaveTextContent(/Your inbox is empty/i);
		await expect
			.element(page.getByTestId('entity-email-empty-pane'))
			.not.toHaveTextContent(/matched this person/i);
	});

	it('gates Draft response for members when AI is disconnected', async () => {
		render(EntityEmailInbox, {
			messages: sampleEmailMessages,
			mailboxConnected: true,
			aiProviderConnected: false,
			smtpReady: false,
			role: 'member'
		});

		await page.getByRole('button', { name: 'Reply' }).click();
		await expect.element(page.getByTestId('draft-response-gate')).toHaveTextContent(/Ask an Owner/i);
		await expect.element(page.getByRole('button', { name: 'Draft response' })).toBeDisabled();
		await expect.element(page.getByTestId('email-send')).toBeDisabled();
		await expect
			.element(page.getByTestId('email-send-gate'))
			.toHaveTextContent(/Connect mailbox/i);
	});

	it('offers Use suggestion after drafting when AI is connected', async () => {
		render(EntityEmailInbox, {
			messages: sampleEmailMessages,
			mailboxConnected: true,
			aiProviderConnected: true,
			smtpReady: true,
			role: 'owner',
			draftDelayMs: 10
		});

		await page.getByRole('button', { name: 'Reply' }).click();
		await page.getByRole('button', { name: 'Draft response' }).click();
		await expect.element(page.getByTestId('use-suggestion')).toBeInTheDocument();
		await page.getByTestId('use-suggestion').click();
		await expect.element(page.getByTestId('draft-suggestion-panel')).not.toBeInTheDocument();
	});
});

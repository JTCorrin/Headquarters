import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { ApiClientError } from '$lib/api/v1/errors.js';
import EntityEmailInbox from './entity-email-inbox.svelte';
import { sampleEmailMessages } from '../../../stories/crm/story-fixtures.js';

describe('EntityEmailInbox', () => {
	beforeEach(async () => {
		await page.viewport(1280, 800);
	});

	afterEach(async () => {
		await page.viewport(1280, 800);
	});
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
		await expect
			.element(page.getByTestId('draft-response-gate'))
			.toHaveTextContent(/Ask an Owner/i);
		await expect.element(page.getByRole('button', { name: 'Draft response' })).toBeDisabled();
		await expect.element(page.getByTestId('email-send')).toBeDisabled();
		await expect.element(page.getByTestId('email-send-gate')).toHaveTextContent(/Connect mailbox/i);
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

	it('surfaces provider API errors from onDraftResponse', async () => {
		render(EntityEmailInbox, {
			messages: sampleEmailMessages,
			mailboxConnected: true,
			aiProviderConnected: true,
			smtpReady: true,
			role: 'owner',
			onDraftResponse: async () => {
				throw new ApiClientError({
					status: 409,
					code: 'CONFLICT',
					message: 'openrouter rejected the API key — reconnect under Org → Integrations'
				});
			}
		});

		await page.getByRole('button', { name: 'Reply' }).click();
		await page.getByRole('button', { name: 'Draft response' }).click();
		await expect
			.element(page.getByTestId('draft-response-error'))
			.toHaveTextContent(/openrouter rejected the API key/i);
	});

	it('clears the composer only after onSendReply succeeds', async () => {
		let resolveSend!: () => void;
		const sendPromise = new Promise<void>((resolve) => {
			resolveSend = resolve;
		});
		const onSendReply = async () => {
			await sendPromise;
		};

		render(EntityEmailInbox, {
			messages: sampleEmailMessages,
			mailboxConnected: true,
			aiProviderConnected: true,
			smtpReady: true,
			role: 'owner',
			onSendReply
		});

		await page.getByRole('button', { name: 'Reply' }).click();
		await page.getByPlaceholder('Write a reply, or use Draft response…').fill('Thanks Ava');
		await page.getByTestId('email-send').click();
		await expect.element(page.getByTestId('email-send')).toHaveTextContent('Sending…');
		await expect
			.element(page.getByPlaceholder('Write a reply, or use Draft response…'))
			.toBeInTheDocument();

		resolveSend();
		await expect.element(page.getByTestId('email-send')).not.toBeInTheDocument();
	});

	it('keeps the composer and shows sendError when onSendReply fails', async () => {
		render(EntityEmailInbox, {
			messages: sampleEmailMessages,
			mailboxConnected: true,
			aiProviderConnected: true,
			smtpReady: true,
			role: 'owner',
			onSendReply: async () => {
				throw new Error('smtp boom');
			}
		});

		await page.getByRole('button', { name: 'Reply' }).click();
		await page.getByPlaceholder('Write a reply, or use Draft response…').fill('Still here');
		await page.getByTestId('email-send').click();
		await expect
			.element(page.getByTestId('email-send-error'))
			.toHaveTextContent(/Could not send reply/i);
		await expect
			.element(page.getByPlaceholder('Write a reply, or use Draft response…'))
			.toHaveValue('Still here');
		await expect.element(page.getByTestId('email-send')).toHaveTextContent('Send');
	});

	it('renders sanitized HTML body and attachment chips', async () => {
		render(EntityEmailInbox, {
			messages: [
				{
					...sampleEmailMessages[0],
					bodyHtml: '<p>Thanks — can we move the kickoff?</p><script>alert(1)</script>',
					attachments: [{ filename: 'invoice.pdf', contentType: 'application/pdf' }]
				}
			],
			mailboxConnected: true,
			role: 'owner'
		});

		await expect.element(page.getByTestId('email-body-html')).toHaveTextContent(/kickoff/i);
		await expect.element(page.getByTestId('email-body-html')).not.toHaveTextContent(/script/i);
		await expect.element(page.getByTestId('email-attachments')).toHaveTextContent(/invoice.pdf/i);
	});

	it('shows Create lead for inbound messages when enabled', async () => {
		let created: { fromAddress: string; fromName: string | null } | null = null;
		render(EntityEmailInbox, {
			messages: sampleEmailMessages,
			mailboxConnected: true,
			aiProviderConnected: true,
			smtpReady: true,
			role: 'owner',
			canCreateLead: true,
			onCreateLead: (payload) => {
				created = {
					fromAddress: payload.fromAddress,
					fromName: payload.fromName
				};
			}
		});

		await expect.element(page.getByTestId('email-create-lead')).toBeInTheDocument();
		await page.getByTestId('email-create-lead').click();
		expect(created).toEqual({
			fromAddress: 'ava@northwind.com',
			fromName: 'Ava Chen'
		});
	});

	it('hides Create lead when canCreateLead is false', async () => {
		render(EntityEmailInbox, {
			messages: sampleEmailMessages,
			mailboxConnected: true,
			role: 'owner',
			canCreateLead: false
		});

		await expect.element(page.getByTestId('email-create-lead')).not.toBeInTheDocument();
	});

	it('opens New compose on an empty inbox', async () => {
		render(EntityEmailInbox, {
			messages: [],
			emptyState: 'no_matches',
			mailboxConnected: true,
			aiProviderConnected: true,
			smtpReady: true,
			role: 'owner',
			defaultTo: 'ava@northwind.com',
			onSendNew: async () => undefined
		});

		await expect.element(page.getByTestId('email-compose-new')).toBeInTheDocument();
		await page.getByTestId('email-compose-new').click();
		await expect.element(page.getByTestId('email-compose-to')).toHaveValue('ava@northwind.com');
		await expect.element(page.getByRole('heading', { name: 'New email' })).toBeInTheDocument();
	});

	it('drafts a new email without a selected message', async () => {
		render(EntityEmailInbox, {
			messages: [],
			emptyState: 'no_matches',
			mailboxConnected: true,
			aiProviderConnected: true,
			smtpReady: true,
			role: 'owner',
			defaultTo: 'ava@northwind.com',
			draftDelayMs: 10,
			onSendNew: async () => undefined
		});

		await page.getByTestId('email-compose-new').click();
		await page.getByRole('button', { name: 'Draft response' }).click();
		await expect.element(page.getByTestId('use-suggestion')).toBeInTheDocument();
	});

	it('sends a new email via onSendNew', async () => {
		let sent: { to: string; subject: string; body: string } | null = null;
		render(EntityEmailInbox, {
			messages: [],
			emptyState: 'no_matches',
			mailboxConnected: true,
			aiProviderConnected: true,
			smtpReady: true,
			role: 'owner',
			defaultTo: 'ava@northwind.com',
			onSendNew: async (payload) => {
				sent = payload;
			}
		});

		await page.getByTestId('email-compose-new').click();
		await page.getByTestId('email-compose-subject').fill('Hello');
		await page.getByPlaceholder('Write a message, or use Draft response…').fill('Can we talk?');
		await page.getByTestId('email-compose-send').click();
		expect(sent).toEqual({
			to: 'ava@northwind.com',
			subject: 'Hello',
			body: 'Can we talk?'
		});
	});

	it('shows one pane at a time on a narrow viewport', async () => {
		await page.viewport(390, 844);
		await expect.poll(() => window.matchMedia('(max-width: 1023px)').matches).toBe(true);

		render(EntityEmailInbox, {
			messages: sampleEmailMessages,
			mailboxConnected: true,
			role: 'owner'
		});

		await expect.element(page.getByText('Re: Q2 retainer kickoff')).toBeVisible();
		await expect.element(page.getByTestId('entity-email-back')).not.toBeInTheDocument();

		await page.getByRole('button', { name: /Re: Q2 retainer kickoff/i }).click();
		await expect.element(page.getByTestId('entity-email-back')).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Reply' })).toBeVisible();

		await page.getByTestId('entity-email-back').click();
		await expect.element(page.getByTestId('entity-email-back')).not.toBeInTheDocument();
		await expect.element(page.getByText('Re: Q2 retainer kickoff')).toBeVisible();
	});
});

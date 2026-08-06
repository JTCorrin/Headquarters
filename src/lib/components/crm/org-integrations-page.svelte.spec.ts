import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import OrgIntegrationsPage from './org-integrations-page.svelte';
import { navGroupsWithActive } from '../../../stories/crm/story-fixtures.js';
import type { AiIntegrationResource } from '$lib/schemas/integration.js';

const integrations: AiIntegrationResource[] = [
	{
		provider: 'openai',
		credentials_configured: false,
		status: 'disconnected',
		last_verified_at: null,
		last_error_code: null
	},
	{
		provider: 'anthropic',
		credentials_configured: true,
		status: 'connected',
		last_verified_at: '2026-08-02T12:00:00Z',
		last_error_code: null
	},
	{
		provider: 'google',
		credentials_configured: false,
		status: 'disconnected',
		last_verified_at: null,
		last_error_code: null
	},
	{
		provider: 'openrouter',
		credentials_configured: false,
		status: 'disconnected',
		last_verified_at: null,
		last_error_code: null
	}
];

describe('OrgIntegrationsPage', () => {
	it('lists all four AI providers with honest API-key connect', async () => {
		const onConnect = vi.fn(async () => true);
		render(OrgIntegrationsPage, {
			orgName: 'Corrin Data',
			navGroups: navGroupsWithActive('Integrations'),
			role: 'owner',
			integrations,
			onConnect
		});

		await expect.element(page.getByTestId('ai-integration-row-openai')).toBeInTheDocument();
		await expect.element(page.getByTestId('ai-integration-row-anthropic')).toBeInTheDocument();
		await expect.element(page.getByTestId('ai-integration-row-google')).toBeInTheDocument();
		await expect.element(page.getByTestId('ai-integration-row-openrouter')).toBeInTheDocument();

		await page.getByTestId('ai-integration-connect-openai').click();
		await expect.element(page.getByTestId('ai-provider-connect-drawer')).toBeInTheDocument();
		await expect
			.element(page.getByText(/OAuth is not offered here/i))
			.toBeInTheDocument();
	});

	it('hides connect actions for members', async () => {
		render(OrgIntegrationsPage, {
			orgName: 'Corrin Data',
			navGroups: navGroupsWithActive('Integrations'),
			role: 'member',
			integrations
		});

		await expect
			.element(page.getByTestId('ai-integrations-section').getByText(/Read-only for your role/i))
			.toBeInTheDocument();
		await expect
			.element(page.getByTestId('ai-integration-connect-openai'))
			.not.toBeInTheDocument();
		await expect.element(page.getByTestId('ai-prompts-save')).not.toBeInTheDocument();
	});

	it('shows AI prompt textareas and saves for owners', async () => {
		const onSavePrompts = vi.fn(async () => true);
		render(OrgIntegrationsPage, {
			orgName: 'Corrin Data',
			navGroups: navGroupsWithActive('Integrations'),
			role: 'owner',
			integrations,
			onSavePrompts
		});

		await expect.element(page.getByTestId('ai-prompts-section')).toBeInTheDocument();
		await expect.element(page.getByTestId('ai-prompt-textarea-email_reply')).toBeInTheDocument();
		await expect
			.element(page.getByTestId('ai-prompt-textarea-meeting_summary'))
			.toBeInTheDocument();
		await page.getByTestId('ai-prompts-save').click();
		expect(onSavePrompts).toHaveBeenCalledOnce();
	});
});

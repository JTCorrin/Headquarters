import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import AiProviderDrawerTestHost from './ai-provider-drawer.test-host.svelte';

describe('AiProviderConnectDrawer', () => {
	it('shows the provider title and write-only key hint when open', async () => {
		render(AiProviderDrawerTestHost, { provider: 'openai' as const });
		await expect.element(page.getByTestId('ai-provider-connect-drawer')).toBeVisible();
		await expect
			.element(page.getByText(/Connect OpenAI/))
			.toBeVisible();
		await expect
			.element(page.getByText(/write-only/i))
			.toBeVisible();
	});

	it('submits the API key and closes on success', async () => {
		const onConnect = vi.fn().mockResolvedValue(true);
		render(AiProviderDrawerTestHost, { provider: 'openai' as const, onConnect });
		const input = page.getByTestId('ai-api-key');
		await expect.element(input).toBeVisible();
		await input.fill('sk-test-123');
		await page.getByTestId('ai-provider-connect-submit').click();
		await vi.waitFor(() => {
			expect(onConnect).toHaveBeenCalledWith('sk-test-123');
		});
		await expect
			.element(page.getByTestId('drawer-open-state'))
			.toHaveTextContent('false');
	});

	it('keeps the drawer visible and shows the fallback error when connect returns false', async () => {
		const onConnect = vi.fn().mockResolvedValue(false);
		render(AiProviderDrawerTestHost, { provider: 'anthropic' as const, onConnect });
		const input = page.getByTestId('ai-api-key');
		await input.fill('sk-ant-test');
		await page.getByTestId('ai-provider-connect-submit').click();
		await vi.waitFor(() => {
			expect(onConnect).toHaveBeenCalledOnce();
		});
		await expect
			.element(page.getByTestId('ai-provider-connect-error'))
			.toHaveTextContent('Could not connect');
		await expect.element(page.getByTestId('ai-api-key')).toBeVisible();
	});

	it('renders a server-provided connectError', async () => {
		render(AiProviderDrawerTestHost, {
			provider: 'google' as const,
			connectError: 'Key rejected by provider'
		});
		await expect
			.element(page.getByTestId('ai-provider-connect-error'))
			.toHaveTextContent('Key rejected by provider');
	});

	it('disables submit until a provider is selected', async () => {
		render(AiProviderDrawerTestHost, { provider: null });
		await expect
			.element(page.getByTestId('ai-provider-connect-submit'))
			.toBeDisabled();
	});
});

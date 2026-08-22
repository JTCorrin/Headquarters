import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import AiAssistAction from './ai-assist-action.svelte';
import AiSuggestionPanel from './ai-suggestion-panel.svelte';

describe('AiAssistAction', () => {
	it('renders its label and forwards clicks', async () => {
		const onclick = vi.fn();
		render(AiAssistAction, { label: 'Draft reply', onclick });
		const button = page.getByRole('button', { name: /Draft reply/ });
		await expect.element(button).toBeEnabled();
		await button.click();
		expect(onclick).toHaveBeenCalledOnce();
	});

	it('shows a busy state and disables clicks while generating', async () => {
		const onclick = vi.fn();
		render(AiAssistAction, { label: 'Draft reply', busy: true, onclick });
		const button = page.getByRole('button', { name: /Working/ });
		await expect.element(button).toBeDisabled();
		expect(onclick).not.toHaveBeenCalled();
	});

	it('respects the disabled prop', async () => {
		const onclick = vi.fn();
		render(AiAssistAction, { label: 'Draft reply', disabled: true, onclick });
		await expect
			.element(page.getByRole('button', { name: /Draft reply/ }))
			.toBeDisabled();
	});
});

describe('AiSuggestionPanel', () => {
	it('shows the idle placeholder and generate action', async () => {
		const onGenerate = vi.fn();
		render(AiSuggestionPanel, { onGenerate });
		await expect.element(page.getByText(/Run the assist when you want a draft/)).toBeVisible();
		const generate = page.getByRole('button', { name: /Generate/ });
		await generate.click();
		expect(onGenerate).toHaveBeenCalledOnce();
	});

	it('shows a drafting placeholder while generating', async () => {
		render(AiSuggestionPanel, { status: 'generating' });
		await expect.element(page.getByText('Drafting…')).toBeVisible();
		await expect
			.element(page.getByRole('button', { name: /Working/ }))
			.toBeDisabled();
	});

	it('shows the editable draft with use/discard once ready', async () => {
		const onUse = vi.fn();
		const onDiscard = vi.fn();
		render(AiSuggestionPanel, {
			status: 'ready',
			value: 'Draft text',
			onUse,
			onDiscard
		});
		const textarea = page.getByRole('textbox');
		await expect.element(textarea).toHaveValue('Draft text');
		await page.getByRole('button', { name: 'Use suggestion' }).click();
		expect(onUse).toHaveBeenCalledOnce();
		await page.getByRole('button', { name: 'Discard' }).click();
		expect(onDiscard).toHaveBeenCalledOnce();
	});

	it('offers a Regenerate action when ready', async () => {
		const onGenerate = vi.fn();
		render(AiSuggestionPanel, { status: 'ready', onGenerate });
		const regenerate = page.getByRole('button', { name: /Regenerate/ });
		await regenerate.click();
		expect(onGenerate).toHaveBeenCalledOnce();
	});

	it('renders variant chips and reports selection', async () => {
		const onVariantChange = vi.fn();
		render(AiSuggestionPanel, {
			status: 'ready',
			variants: [
				{ id: 'neutral', label: 'Neutral' },
				{ id: 'friendly', label: 'Friendly' }
			],
			activeVariant: 'neutral',
			onVariantChange
		});
		const friendly = page.getByRole('button', { name: 'Friendly' });
		await friendly.click();
		expect(onVariantChange).toHaveBeenCalledWith('friendly');
	});

	it('uses a custom generate label while idle', async () => {
		render(AiSuggestionPanel, { generateLabel: 'Suggest chase' });
		await expect
			.element(page.getByRole('button', { name: /Suggest chase/ }))
			.toBeVisible();
	});

	it('uses a custom label for the use action when ready', async () => {
		render(AiSuggestionPanel, {
			useLabel: 'Insert into email',
			status: 'ready',
			onUse: () => {}
		});
		await expect
			.element(page.getByRole('button', { name: 'Insert into email' }))
			.toBeVisible();
	});
});

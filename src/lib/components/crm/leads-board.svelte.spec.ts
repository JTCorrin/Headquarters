import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import LeadsBoard from './leads-board.svelte';

const leadId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const leads = [
	{
		id: leadId,
		name: 'Contoso expansion',
		companyName: 'Contoso',
		valueCents: 1_800_000,
		currency: 'GBP',
		owner: 'Joe',
		stage: 'proposal' as const,
		version: 3
	}
];

describe('LeadsBoard selection', () => {
	it('resolves SVAR setID-encoded data-id for mouse selection', async () => {
		const onSelectLead = vi.fn();
		render(LeadsBoard, { leads, onSelectLead });

		const card = page.getByRole('button', { name: /Contoso expansion/i });
		await expect.element(card).toBeInTheDocument();

		const el = card.element() as HTMLElement;
		expect(el.getAttribute('data-id')).toBe(`:${leadId}`);

		await card.click();
		expect(onSelectLead).toHaveBeenCalledWith(leadId);
		expect(onSelectLead).not.toHaveBeenCalledWith(`:${leadId}`);
	});

	it('resolves SVAR setID-encoded data-id for keyboard selection', async () => {
		const onSelectLead = vi.fn();
		render(LeadsBoard, { leads, onSelectLead });

		const card = page.getByRole('button', { name: /Contoso expansion/i });
		await expect.element(card).toBeInTheDocument();

		const el = card.element() as HTMLElement;
		el.focus();
		el.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
		);

		expect(onSelectLead).toHaveBeenCalledWith(leadId);
		expect(onSelectLead).not.toHaveBeenCalledWith(`:${leadId}`);
	});
});

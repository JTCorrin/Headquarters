import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import LeadsBoard from './leads-board.svelte';

const leadA = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const leadB = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const leadC = 'cccccccc-cccc-4ddd-8eee-ffffffffffff';

const leads = [
	{
		id: leadA,
		name: 'Alpha deal',
		companyName: 'Alpha',
		valueCents: 100_000,
		currency: 'GBP',
		stage: 'new' as const,
		version: 1,
		position: 0
	},
	{
		id: leadB,
		name: 'Bravo deal',
		companyName: 'Bravo',
		valueCents: 200_000,
		currency: 'GBP',
		stage: 'new' as const,
		version: 2,
		position: 1000
	},
	{
		id: leadC,
		name: 'Contoso expansion',
		companyName: 'Contoso',
		valueCents: 1_800_000,
		currency: 'GBP',
		owner: 'Joe',
		stage: 'proposal' as const,
		version: 3,
		position: 0
	}
];

describe('LeadsBoard selection', () => {
	it('resolves SVAR setID-encoded data-id for mouse selection', async () => {
		const onSelectLead = vi.fn();
		render(LeadsBoard, { leads, onSelectLead });

		const card = page.getByLabelText('Contoso expansion', { exact: true });
		await expect.element(card).toBeInTheDocument();

		const el = card.element() as HTMLElement;
		expect(el.getAttribute('data-id')).toBe(`:${leadC}`);

		await card.click();
		expect(onSelectLead).toHaveBeenCalledWith(leadC);
		expect(onSelectLead).not.toHaveBeenCalledWith(`:${leadC}`);
	});

	it('resolves SVAR setID-encoded data-id for keyboard selection', async () => {
		const onSelectLead = vi.fn();
		render(LeadsBoard, { leads, onSelectLead });

		const card = page.getByLabelText('Contoso expansion', { exact: true });
		await expect.element(card).toBeInTheDocument();

		const el = card.element() as HTMLElement;
		el.focus();
		el.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
		);

		expect(onSelectLead).toHaveBeenCalledWith(leadC);
		expect(onSelectLead).not.toHaveBeenCalledWith(`:${leadC}`);
	});
});

describe('LeadsBoard keyboard moves', () => {
	it('exposes stage and within-stage controls that emit onMoveLead', async () => {
		const onMoveLead = vi.fn();
		render(LeadsBoard, { leads, onMoveLead });

		await expect.element(page.getByTestId('leads-board-keyboard-moves')).toBeInTheDocument();

		await page.getByTestId(`lead-move-up-${leadB}`).click();
		expect(onMoveLead).toHaveBeenCalledWith(
			expect.objectContaining({
				id: leadB,
				stage: 'new',
				beforeId: leadA
			})
		);

		onMoveLead.mockClear();
		await page.getByTestId(`lead-move-down-${leadA}`).click();
		expect(onMoveLead).toHaveBeenCalledWith(
			expect.objectContaining({
				id: leadA,
				stage: 'new'
			})
		);

		onMoveLead.mockClear();
		const stageTrigger = page.getByTestId(`lead-stage-${leadC}`);
		await stageTrigger.click();
		await page.getByRole('option', { name: 'Qualified' }).click();
		expect(onMoveLead).toHaveBeenCalledWith(
			expect.objectContaining({
				id: leadC,
				stage: 'qualified',
				beforeId: null
			})
		);
	});

	it('disables up at the top of a column', async () => {
		render(LeadsBoard, { leads });
		await expect.element(page.getByTestId(`lead-move-up-${leadA}`)).toBeDisabled();
		await expect.element(page.getByTestId(`lead-move-down-${leadB}`)).toBeDisabled();
	});
});

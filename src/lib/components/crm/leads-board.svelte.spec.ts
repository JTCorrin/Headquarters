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

describe('LeadsBoard card moves', () => {
	it('puts Move up/down on cards and emits onMoveLead', async () => {
		const onMoveLead = vi.fn();
		render(LeadsBoard, { leads, onMoveLead });

		await expect.element(page.getByTestId('leads-board-keyboard-moves')).not.toBeInTheDocument();
		await expect.element(page.getByTestId(`lead-card-${leadB}`)).toBeInTheDocument();

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
	});

	it('disables up at the top of a column', async () => {
		render(LeadsBoard, { leads });
		await expect.element(page.getByTestId(`lead-move-up-${leadA}`)).toBeDisabled();
		await expect.element(page.getByTestId(`lead-move-down-${leadB}`)).toBeDisabled();
	});
});

describe('LeadsBoard column affordances', () => {
	it('keeps empty columns tall enough for drop targets and expand controls clickable', async () => {
		render(LeadsBoard, {
			leads: leads.filter((lead) => lead.stage !== 'qualified')
		});

		const board = page.getByTestId('leads-board').element() as HTMLElement;
		const theme = board.querySelector('.crm-svar-kanban-theme') as HTMLElement | null;
		expect(theme).toBeTruthy();

		const columns = [...board.querySelectorAll('.wx-column')] as HTMLElement[];
		expect(columns.length).toBeGreaterThan(0);

		const emptyQualified = columns.find((column) =>
			column.textContent?.toLowerCase().includes('qualified')
		);
		expect(emptyQualified).toBeTruthy();
		expect(emptyQualified!.classList.contains('wx-collapsed')).toBe(false);
		expect(emptyQualified!.getBoundingClientRect().height).toBeGreaterThanOrEqual(280);

		const collapse = emptyQualified!.querySelector('.wx-toggle') as HTMLButtonElement | null;
		expect(collapse).toBeTruthy();
		collapse!.click();

		await expect
			.poll(() => emptyQualified!.classList.contains('wx-collapsed'))
			.toBe(true);

		const expand = emptyQualified!.querySelector('.wx-expand') as HTMLButtonElement | null;
		expect(expand).toBeTruthy();
		const title = emptyQualified!.querySelector('.wx-title') as HTMLElement | null;
		expect(getComputedStyle(title!).pointerEvents).toBe('none');
		expect(getComputedStyle(expand!).pointerEvents).toBe('auto');

		expand!.click();
		await expect
			.poll(() => emptyQualified!.classList.contains('wx-collapsed'))
			.toBe(false);
	});
});

import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import DateRangeFieldTestHost from './date-range-field.test-host.svelte';

describe('DateRangeField', () => {
	it('accepts typed start and end YYYY-MM-DD values', async () => {
		render(DateRangeFieldTestHost, { initialStart: '', initialEnd: '' });

		await page.getByTestId('date-range-field-start').fill('2026-08-01');
		await page.getByTestId('date-range-field-end').fill('2026-08-31');

		await expect
			.element(page.getByTestId('date-range-start-value'))
			.toHaveTextContent('2026-08-01');
		await expect.element(page.getByTestId('date-range-end-value')).toHaveTextContent('2026-08-31');
	});

	it('rejects an end date before start', async () => {
		render(DateRangeFieldTestHost, { initialStart: '2026-08-15', initialEnd: '' });

		const end = page.getByTestId('date-range-field-end');
		await end.fill('2026-08-01');
		await page.getByTestId('date-range-start-value').click();

		await expect.element(page.getByTestId('date-range-end-value')).toHaveTextContent('');
		await expect.element(end).toHaveValue('');
	});

	it('opens the range calendar with month/year dropdowns', async () => {
		render(DateRangeFieldTestHost, { initialStart: '2026-08-03', initialEnd: '' });

		await page.getByTestId('date-range-field-calendar').click();
		await expect.element(page.getByRole('grid')).toBeInTheDocument();
		await expect.element(page.getByRole('combobox').first()).toBeInTheDocument();
	});

	it('clears both sides from the range preset clear', async () => {
		render(DateRangeFieldTestHost, {
			initialStart: '2026-08-01',
			initialEnd: '2026-08-31'
		});

		await page.getByTestId('date-range-field-calendar').click();
		await page.getByTestId('date-range-field-preset-clear').click();

		await expect.element(page.getByTestId('date-range-start-value')).toHaveTextContent('');
		await expect.element(page.getByTestId('date-range-end-value')).toHaveTextContent('');
	});
});

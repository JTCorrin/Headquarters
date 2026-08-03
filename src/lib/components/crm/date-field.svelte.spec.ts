import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import DateFieldTestHost from './date-field.test-host.svelte';

describe('DateField', () => {
	it('selects a day from the calendar and writes YYYY-MM-DD', async () => {
		render(DateFieldTestHost, { initial: '2026-08-03' });

		await page.getByTestId('date-field-calendar').click();
		await expect.element(page.getByRole('grid')).toBeInTheDocument();
		await expect.element(page.getByRole('combobox').first()).toBeInTheDocument();

		await page.getByRole('button', { name: '15' }).click();
		await expect.element(page.getByTestId('date-field-value')).toHaveTextContent('2026-08-15');
		await expect.element(page.getByTestId('date-field')).toHaveValue('2026-08-15');
	});

	it('accepts typed YYYY-MM-DD and clears via the clear control', async () => {
		render(DateFieldTestHost, { initial: '' });

		const input = page.getByTestId('date-field');
		await input.fill('2026-09-01');
		await expect.element(page.getByTestId('date-field-value')).toHaveTextContent('2026-09-01');

		await page.getByTestId('date-field-clear').click();
		await expect.element(page.getByTestId('date-field-value')).toHaveTextContent('');
		await expect.element(input).toHaveValue('');
	});

	it('stays non-interactive when disabled', async () => {
		render(DateFieldTestHost, { initial: '2026-08-03', disabled: true });

		await expect.element(page.getByTestId('date-field')).toBeDisabled();
		expect(page.getByTestId('date-field-calendar').query()).toBeNull();
		expect(page.getByTestId('date-field-clear').query()).toBeNull();
		await expect.element(page.getByRole('grid')).not.toBeInTheDocument();
	});

	it('sets today from the calendar preset', async () => {
		render(DateFieldTestHost, { initial: '2020-01-01' });

		await page.getByTestId('date-field-calendar').click();
		await page.getByTestId('date-field-preset-today').click();

		const value = (await page.getByTestId('date-field-value').element()).textContent ?? '';
		expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(value).not.toBe('2020-01-01');
	});

	it('offers due-date presets (+7 / end of month)', async () => {
		render(DateFieldTestHost, {
			initial: '2026-08-03',
			presets: ['today', 'plus7', 'endOfMonth']
		});

		await page.getByTestId('date-field-calendar').click();
		await expect.element(page.getByTestId('date-field-preset-plus7')).toBeInTheDocument();
		await expect.element(page.getByTestId('date-field-preset-endOfMonth')).toBeInTheDocument();

		await page.getByTestId('date-field-preset-plus7').click();
		const value = (await page.getByTestId('date-field-value').element()).textContent ?? '';
		expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(value).not.toBe('2026-08-03');
	});

	it('rejects typed values below min', async () => {
		render(DateFieldTestHost, { initial: '2026-08-10', min: '2026-08-10' });

		const input = page.getByTestId('date-field');
		await input.fill('2026-08-01');
		await page.getByTestId('date-field-value').click();

		await expect.element(page.getByTestId('date-field-value')).toHaveTextContent('2026-08-10');
		await expect.element(input).toHaveValue('2026-08-10');
	});
});

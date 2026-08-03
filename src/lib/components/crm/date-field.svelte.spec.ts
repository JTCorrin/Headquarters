import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import DateFieldTestHost from './date-field.test-host.svelte';

describe('DateField', () => {
	it('selects a day and writes YYYY-MM-DD', async () => {
		render(DateFieldTestHost, { initial: '2026-08-03' });

		await page.getByTestId('date-field').click();
		await expect.element(page.getByRole('grid')).toBeInTheDocument();

		await page.getByRole('button', { name: '15' }).click();
		await expect.element(page.getByTestId('date-field-value')).toHaveTextContent('2026-08-15');
		await expect.element(page.getByTestId('date-field')).toHaveTextContent('2026-08-15');
	});

	it('clears the value when clear is pressed', async () => {
		render(DateFieldTestHost, { initial: '2026-08-03' });

		await expect.element(page.getByTestId('date-field-value')).toHaveTextContent('2026-08-03');
		await page.getByTestId('date-field-clear').click();
		await expect.element(page.getByTestId('date-field-value')).toHaveTextContent('');
	});

	it('stays closed and non-interactive when disabled', async () => {
		render(DateFieldTestHost, { initial: '2026-08-03', disabled: true });

		await expect.element(page.getByTestId('date-field')).toBeDisabled();
		await expect.element(page.getByRole('grid')).not.toBeInTheDocument();
		expect(page.getByTestId('date-field-clear').query()).toBeNull();
	});
});

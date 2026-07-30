import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import DataTableShell from './data-table-shell.svelte';
import { contactColumns } from './contacts-columns.js';

const rows = [
	{ id: '1', name: 'Zed', email: 'z@ex.com', status: 'Lead' },
	{ id: '2', name: 'Amy', email: 'a@ex.com', status: 'Client' },
	{ id: '3', name: 'Mia', email: 'm@ex.com', status: 'Contact' }
];

describe('DataTableShell', () => {
	it('sorts by name when header clicked', async () => {
		render(DataTableShell, {
			columns: contactColumns,
			data: rows,
			filterColumn: 'name',
			filterPlaceholder: 'Filter contacts…',
			pageSize: 8
		});

		await page.getByRole('button', { name: /name/i }).click();
		await expect.element(page.getByRole('row').nth(1).getByRole('cell').nth(1)).toHaveTextContent(
			'Amy'
		);
	});

	it('filters by name', async () => {
		render(DataTableShell, {
			columns: contactColumns,
			data: rows,
			filterColumn: 'name',
			filterPlaceholder: 'Filter contacts…',
			pageSize: 8
		});

		await page.getByPlaceholder('Filter contacts…').fill('Amy');
		await expect.element(page.getByText('Amy')).toBeInTheDocument();
		await expect.element(page.getByText('Zed')).not.toBeInTheDocument();
	});

	it('selects a row via checkbox', async () => {
		render(DataTableShell, {
			columns: contactColumns,
			data: rows,
			filterColumn: 'name',
			pageSize: 8
		});

		await page.getByRole('checkbox', { name: 'Select row' }).nth(0).click();
		await expect.element(page.getByText('1 of 3 row(s) selected.')).toBeInTheDocument();
	});
});

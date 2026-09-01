import { describe, expect, it, afterEach } from 'vitest';
import type { ColumnDef } from '@tanstack/table-core';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { renderComponent } from '$lib/components/ui/data-table/index.js';
import DataTableShell from './data-table-shell.svelte';
import { invoiceStatusFacet } from './data-table-facets.js';
import { contactColumns } from './contacts-columns.js';
import DataTableCheckbox from './data-table-checkbox.svelte';
import DataTableSortHeader from './data-table-sort-header.svelte';

const rows = [
	{ id: '1', name: 'Zed', email: 'z@ex.com', status: 'Lead' },
	{ id: '2', name: 'Amy', email: 'a@ex.com', status: 'Client' },
	{ id: '3', name: 'Mia', email: 'm@ex.com', status: 'Contact' }
];

type Row = (typeof rows)[number];

const selectableColumns: ColumnDef<Row>[] = [
	{
		id: 'select',
		header: ({ table }) =>
			renderComponent(DataTableCheckbox, {
				checked: table.getIsAllPageRowsSelected(),
				indeterminate: table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected(),
				onCheckedChange: (value) => table.toggleAllPageRowsSelected(!!value),
				'aria-label': 'Select all'
			}),
		cell: ({ row }) =>
			renderComponent(DataTableCheckbox, {
				checked: row.getIsSelected(),
				onCheckedChange: (value) => row.toggleSelected(!!value),
				'aria-label': 'Select row'
			}),
		enableSorting: false,
		enableHiding: false
	},
	{
		accessorKey: 'name',
		header: ({ column }) =>
			renderComponent(DataTableSortHeader, {
				label: 'Name',
				onclick: column.getToggleSortingHandler()
			})
	}
];

describe('DataTableShell', () => {
	afterEach(async () => {
		await page.viewport(1280, 720);
	});
	it('sorts by name when header clicked', async () => {
		render(DataTableShell, {
			columns: contactColumns as ColumnDef<unknown, unknown>[],
			data: rows,
			filterColumn: 'name',
			filterPlaceholder: 'Filter contacts…',
			pageSize: 8
		});

		await page.getByRole('button', { name: /name/i }).click();
		await expect.element(page.getByRole('row').nth(1).getByRole('cell').nth(0)).toHaveTextContent(
			'Amy'
		);
	});

	it('filters by name', async () => {
		render(DataTableShell, {
			columns: contactColumns as ColumnDef<unknown, unknown>[],
			data: rows,
			filterColumn: 'name',
			filterPlaceholder: 'Filter contacts…',
			pageSize: 8
		});

		await page.getByPlaceholder('Filter contacts…').fill('Amy');
		await expect.element(page.getByText('Amy')).toBeInTheDocument();
		await expect.element(page.getByText('Zed')).not.toBeInTheDocument();
	});

	it('hides selection chrome when columns have no select column', async () => {
		render(DataTableShell, {
			columns: contactColumns as ColumnDef<unknown, unknown>[],
			data: rows,
			filterColumn: 'name',
			pageSize: 8
		});

		await expect.element(page.getByText('3 row(s)')).toBeInTheDocument();
		await expect.element(page.getByRole('checkbox', { name: 'Select row' })).not.toBeInTheDocument();
	});

	it('selects a row via checkbox when a select column is present', async () => {
		render(DataTableShell, {
			columns: selectableColumns as ColumnDef<unknown, unknown>[],
			data: rows,
			filterColumn: 'name',
			pageSize: 8
		});

		await page.getByRole('checkbox', { name: 'Select row' }).nth(0).click();
		await expect.element(page.getByText('1 of 3 row(s) selected.')).toBeInTheDocument();
	});

	it('hides secondary columns on a mobile viewport', async () => {
		await page.viewport(390, 844);
		await expect
			.poll(() => window.matchMedia('(max-width: 767px)').matches)
			.toBe(true);

		render(DataTableShell, {
			columns: contactColumns as ColumnDef<unknown, unknown>[],
			data: rows,
			filterColumn: 'name',
			pageSize: 8
		});

		await expect.element(page.getByRole('button', { name: /name/i })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: /status/i })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: /email/i })).not.toBeInTheDocument();
	});

	it('filters by a single status facet', async () => {
		render(DataTableShell, {
			columns: contactColumns as ColumnDef<unknown, unknown>[],
			data: rows,
			filterColumn: 'name',
			pageSize: 8,
			facets: [
				{
					column: 'status',
					label: 'Status',
					options: [
						{ value: 'Lead', label: 'Lead' },
						{ value: 'Client', label: 'Client' },
						{ value: 'Contact', label: 'Contact' }
					]
				}
			]
		});

		await page.getByTestId('data-table-facet-status').click();
		await page.getByRole('option', { name: 'Client' }).click();
		await expect.element(page.getByText('1 row(s)')).toBeInTheDocument();
		await expect.element(page.getByRole('cell', { name: 'Amy' })).toBeInTheDocument();
		await expect.element(page.getByRole('cell', { name: 'Zed' })).not.toBeInTheDocument();
		await expect.element(page.getByRole('cell', { name: 'Mia' })).not.toBeInTheDocument();
	});

	it('filters Unpaid as Sent, Partial, and Overdue', async () => {
		const invoiceRows = [
			{ id: '1', name: 'Paid co', email: 'a@ex.com', status: 'Paid' },
			{ id: '2', name: 'Sent co', email: 'b@ex.com', status: 'Sent' },
			{ id: '3', name: 'Partial co', email: 'c@ex.com', status: 'Partial' },
			{ id: '4', name: 'Overdue co', email: 'd@ex.com', status: 'Overdue' },
			{ id: '5', name: 'Draft co', email: 'e@ex.com', status: 'Draft' },
			{ id: '6', name: 'Void co', email: 'f@ex.com', status: 'Void' }
		];

		render(DataTableShell, {
			columns: contactColumns as ColumnDef<unknown, unknown>[],
			data: invoiceRows,
			filterColumn: 'name',
			pageSize: 8,
			facets: [invoiceStatusFacet]
		});

		await page.getByTestId('data-table-facet-status').click();
		await page.getByRole('option', { name: 'Unpaid' }).click();
		await expect.element(page.getByText('3 row(s)')).toBeInTheDocument();
		await expect.element(page.getByRole('cell', { name: 'Sent co' })).toBeInTheDocument();
		await expect.element(page.getByRole('cell', { name: 'Partial co' })).toBeInTheDocument();
		await expect.element(page.getByRole('cell', { name: 'Overdue co' })).toBeInTheDocument();
		await expect.element(page.getByRole('cell', { name: 'Paid co' })).not.toBeInTheDocument();
		await expect.element(page.getByRole('cell', { name: 'Draft co' })).not.toBeInTheDocument();
		await expect.element(page.getByRole('cell', { name: 'Void co' })).not.toBeInTheDocument();
	});
});

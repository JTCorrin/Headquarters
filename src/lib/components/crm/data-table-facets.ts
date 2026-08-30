import type { ColumnDef, FilterFn, Row } from '@tanstack/table-core';

export const ALL_FACET_VALUE = '__all__';

export interface DataTableFacetOption {
	value: string;
	label: string;
	/** Cell values this option includes; defaults to `[value]`. */
	match?: string[];
}

export interface DataTableFacet {
	column: string;
	label: string;
	options: DataTableFacetOption[];
}

function options(...values: string[]): DataTableFacetOption[] {
	return values.map((value) => ({ value, label: value }));
}

function labelled(values: Array<[value: string, label: string]>): DataTableFacetOption[] {
	return values.map(([value, label]) => ({ value, label }));
}

export const invoiceStatusFacet: DataTableFacet = {
	column: 'status',
	label: 'Status',
	options: [
		{ value: 'Unpaid', label: 'Unpaid', match: ['Sent', 'Partial', 'Overdue'] },
		...options('Draft', 'Sent', 'Partial', 'Overdue', 'Paid', 'Void')
	]
};

export const billStatusFacet: DataTableFacet = {
	column: 'status',
	label: 'Status',
	options: [
		{
			value: 'Unpaid',
			label: 'Unpaid',
			match: ['Received', 'Scheduled', 'Partial', 'Overdue']
		},
		...options('Draft', 'Received', 'Scheduled', 'Partial', 'Overdue', 'Paid', 'Void')
	]
};

export const quoteStatusFacet: DataTableFacet = {
	column: 'status',
	label: 'Status',
	options: options('Draft', 'Sent', 'Accepted', 'Rejected', 'Expired', 'Void')
};

export const contactStatusFacet: DataTableFacet = {
	column: 'status',
	label: 'Status',
	options: options('Active', 'Inactive', 'Archived')
};

export const clientStatusFacet: DataTableFacet = {
	column: 'status',
	label: 'Status',
	options: options('Prospect', 'Active', 'On Hold', 'Inactive', 'Archived')
};

export const leadStageFacet: DataTableFacet = {
	column: 'stage',
	label: 'Stage',
	options: options('New', 'Qualified', 'Proposal', 'Won', 'Lost')
};

export const taskStatusFacet: DataTableFacet = {
	column: 'status',
	label: 'Status',
	options: options('Open', 'In progress', 'Blocked', 'Done', 'Cancelled')
};

export const productStatusFacet: DataTableFacet = {
	column: 'status',
	label: 'Status',
	options: options('Active', 'Archived')
};

export const paymentStatusFacet: DataTableFacet = {
	column: 'status',
	label: 'Status',
	options: options(
		'Pending',
		'Completed',
		'Unallocated',
		'Part Allocated',
		'Allocated',
		'Refunded',
		'Reversed',
		'Failed'
	)
};

export const meetingStatusFacet: DataTableFacet = {
	column: 'status',
	label: 'Status',
	options: options('Scheduled', 'In progress', 'Completed', 'Cancelled')
};

export const recurringInvoiceStatusFacet: DataTableFacet = {
	column: 'status',
	label: 'Status',
	options: options('Draft', 'Active', 'Paused', 'Completed', 'Cancelled')
};

export const emailTemplateStatusFacet: DataTableFacet = {
	column: 'status',
	label: 'Status',
	options: labelled([
		['draft', 'Draft'],
		['active', 'Active'],
		['archived', 'Archived']
	])
};

export function columnDefId<TData, TValue>(column: ColumnDef<TData, TValue>): string | undefined {
	if (column.id) return column.id;
	if ('accessorKey' in column && column.accessorKey != null) {
		return String(column.accessorKey);
	}
	return undefined;
}

export function facetFilterFn<TData>(facet: DataTableFacet): FilterFn<TData> {
	return (row: Row<TData>, columnId, filterValue) => {
		if (filterValue == null || filterValue === '' || filterValue === ALL_FACET_VALUE) {
			return true;
		}
		const option = facet.options.find((o) => o.value === filterValue);
		const matches = option?.match ?? [String(filterValue)];
		return matches.includes(String(row.getValue(columnId) ?? ''));
	};
}

export function withFacetFilterFns<TData, TValue>(
	columns: ColumnDef<TData, TValue>[],
	facets: DataTableFacet[] | undefined
): ColumnDef<TData, TValue>[] {
	if (!facets?.length) return columns;
	const byColumn = new Map(facets.map((facet) => [facet.column, facet]));
	return columns.map((column) => {
		const id = columnDefId(column);
		if (!id) return column;
		const facet = byColumn.get(id);
		if (!facet) return column;
		return { ...column, filterFn: facetFilterFn<TData>(facet) };
	});
}

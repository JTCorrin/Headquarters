<script lang="ts">
	import DataTableShell from './data-table-shell.svelte';
	import { auditLogColumns, type AuditLogRow } from './audit-log-columns.js';

	export type { AuditLogRow };

	export interface AuditLogTableProps {
		rows: AuditLogRow[];
		class?: string;
	}

	let { rows, class: className }: AuditLogTableProps = $props();
</script>

<DataTableShell
	data={rows}
	columns={auditLogColumns}
	filterColumn="event"
	filterPlaceholder="Filter events…"
	emptyMessage="No audit events yet."
	class={className}
/>

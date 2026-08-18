<script lang="ts">
	import DataTableShell from './data-table-shell.svelte';
	import { emailTemplateStatusFacet } from './data-table-facets.js';
	import { emailTemplateColumns, type EmailTemplateRow } from './email-templates-columns.js';

	export type { EmailTemplateRow };

	export interface EmailTemplatesTableProps {
		rows: EmailTemplateRow[];
		class?: string;
	}

	let { rows, class: className }: EmailTemplatesTableProps = $props();
</script>

<DataTableShell
	data={rows}
	columns={emailTemplateColumns}
	filterColumn="name"
	filterPlaceholder="Filter templates…"
	facets={[emailTemplateStatusFacet]}
	emptyMessage="No email templates yet."
	class={className}
/>

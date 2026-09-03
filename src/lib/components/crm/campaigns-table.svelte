<script lang="ts">
	import DataTableShell from './data-table-shell.svelte';
	import { campaignColumns, type CampaignRow } from './campaigns-columns.js';

	export interface CampaignsTableProps {
		rows: CampaignRow[];
	}

	let { rows }: CampaignsTableProps = $props();
</script>

<DataTableShell
	columns={campaignColumns}
	data={rows}
	filterColumn="name"
	filterPlaceholder="Filter campaigns…"
	emptyMessage="No campaigns match your filter."
/>

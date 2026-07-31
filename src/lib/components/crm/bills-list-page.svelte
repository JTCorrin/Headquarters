<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { BillFormData } from '$lib/schemas/bill.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import BillsTable from './bills-table.svelte';
	import type { BillRow } from './bills-columns.js';
	import BillFormDrawer from './bill-form-drawer.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface BillsListPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		rows: BillRow[];
		form: SuperForm<BillFormData>;
		drawerOpen?: boolean;
		class?: string;
	}

	let {
		orgName,
		navGroups,
		rows,
		form,
		drawerOpen = $bindable(false),
		class: className
	}: BillsListPageProps = $props();
</script>

<div class={cn('bg-background text-foreground flex h-full min-h-[720px]', className)}>
	<AppNav {orgName} groups={navGroups} class="shrink-0" />

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-6 py-6 md:px-8">
			<PageHeader
				breadcrumb="Accounting"
				title="Bills"
				description="Vendor bills you receive — accounts payable."
			>
				{#snippet actions()}
					<BillFormDrawer bind:open={drawerOpen} {form}>
						{#snippet trigger()}
							<Button type="button" size="sm">New bill</Button>
						{/snippet}
					</BillFormDrawer>
				{/snippet}
			</PageHeader>

			<BillsTable {rows} />
		</div>
	</main>
</div>

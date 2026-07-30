<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { InvoiceFormData } from '$lib/schemas/invoice.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import InvoicesTable from './invoices-table.svelte';
	import type { InvoiceRow } from './invoices-columns.js';
	import InvoiceFormDrawer from './invoice-form-drawer.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface InvoicesListPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		rows: InvoiceRow[];
		form: SuperForm<InvoiceFormData>;
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
	}: InvoicesListPageProps = $props();
</script>

<div class={cn('bg-background text-foreground flex h-full min-h-[720px]', className)}>
	<AppNav {orgName} groups={navGroups} class="shrink-0" />

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-6 py-6 md:px-8">
			<PageHeader
				breadcrumb="Money"
				title="Invoices"
				description="Track sent, partial, and paid invoices."
			>
				{#snippet actions()}
					<InvoiceFormDrawer bind:open={drawerOpen} {form}>
						{#snippet trigger()}
							<Button type="button" size="sm">New invoice</Button>
						{/snippet}
					</InvoiceFormDrawer>
				{/snippet}
			</PageHeader>

			<InvoicesTable {rows} />
		</div>
	</main>
</div>

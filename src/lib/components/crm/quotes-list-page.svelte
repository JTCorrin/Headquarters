<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { QuoteFormData } from '$lib/schemas/quote.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import QuotesTable from './quotes-table.svelte';
	import type { QuoteRow } from './quotes-columns.js';
	import QuoteFormDrawer from './quote-form-drawer.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface QuotesListPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		rows: QuoteRow[];
		form: SuperForm<QuoteFormData>;
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
	}: QuotesListPageProps = $props();
</script>

<div class={cn('bg-background text-foreground flex h-full min-h-[720px]', className)}>
	<AppNav {orgName} groups={navGroups} class="shrink-0" />

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-6 py-6 md:px-8">
			<PageHeader
				breadcrumb="Accounting"
				title="Quotes"
				description="Draft, send, and convert quotes into invoices."
			>
				{#snippet actions()}
					<QuoteFormDrawer bind:open={drawerOpen} {form}>
						{#snippet trigger()}
							<Button type="button" size="sm">New quote</Button>
						{/snippet}
					</QuoteFormDrawer>
				{/snippet}
			</PageHeader>

			<QuotesTable {rows} />
		</div>
	</main>
</div>

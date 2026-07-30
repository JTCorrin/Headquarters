<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { QuoteFormData } from '$lib/schemas/quote.js';
	import type { CatalogProductOption, LineItemFormData } from '$lib/schemas/line-item.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import QuoteForm from './quote-form.svelte';
	import LineItemForm from './line-item-form.svelte';
	import LineItemsTable, { type LineItemRow } from './line-items-table.svelte';
	import StatusBadge from './status-badge.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface QuoteDetailPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		title: string;
		status: string;
		quoteForm: SuperForm<QuoteFormData>;
		lineForm: SuperForm<LineItemFormData>;
		products?: CatalogProductOption[];
		lines?: LineItemRow[];
		onRemoveLine?: (id: string) => void;
		class?: string;
	}

	let {
		orgName,
		navGroups,
		title,
		status,
		quoteForm,
		lineForm,
		products = [],
		lines = $bindable<LineItemRow[]>([]),
		onRemoveLine,
		class: className
	}: QuoteDetailPageProps = $props();
</script>

<div class={cn('bg-background text-foreground flex h-full min-h-[720px]', className)}>
	<AppNav {orgName} groups={navGroups} class="shrink-0" />

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-6 py-6 md:px-8">
			<PageHeader breadcrumb="Money / Quotes" {title} description="Header fields left; lines right.">
				{#snippet actions()}
					<StatusBadge {status} />
					<Button variant="outline" size="sm">Send</Button>
					<Button size="sm">Convert to invoice</Button>
				{/snippet}
			</PageHeader>

			<div class="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.15fr)]">
				<div class="space-y-6">
					<section
						class="bg-card space-y-4 rounded-3xl p-5 ring-1 ring-foreground/5 dark:ring-foreground/10"
					>
						<h2 class="text-sm font-semibold tracking-tight">Quote details</h2>
						<QuoteForm form={quoteForm} submitLabel="Save details" />
					</section>

					<section
						class="bg-card space-y-4 rounded-3xl p-5 ring-1 ring-foreground/5 dark:ring-foreground/10"
					>
						<div>
							<h2 class="text-sm font-semibold tracking-tight">Add line item</h2>
							<p class="text-muted-foreground text-xs">
								Link a product from the catalog, or enter a custom line.
							</p>
						</div>
						<LineItemForm form={lineForm} {products} />
					</section>
				</div>

				<LineItemsTable rows={lines} onRemove={onRemoveLine} class="self-start" />
			</div>
		</div>
	</main>
</div>

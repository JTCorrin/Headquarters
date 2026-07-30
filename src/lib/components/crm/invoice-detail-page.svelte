<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { InvoiceFormData } from '$lib/schemas/invoice.js';
	import type { CatalogProductOption, LineItemFormData } from '$lib/schemas/line-item.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import InvoiceForm from './invoice-form.svelte';
	import LineItemForm from './line-item-form.svelte';
	import LineItemsTable, { type LineItemRow } from './line-items-table.svelte';
	import StatusBadge from './status-badge.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface InvoiceDetailPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		title: string;
		status: string;
		invoiceForm: SuperForm<InvoiceFormData>;
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
		invoiceForm,
		lineForm,
		products = [],
		lines = $bindable<LineItemRow[]>([]),
		onRemoveLine,
		class: className
	}: InvoiceDetailPageProps = $props();
</script>

<div class={cn('bg-background text-foreground flex h-full min-h-[720px]', className)}>
	<AppNav {orgName} groups={navGroups} class="shrink-0" />

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-6 py-6 md:px-8">
			<PageHeader
				breadcrumb="Money / Invoices"
				{title}
				description="Header fields left; product-linked lines on the right."
			>
				{#snippet actions()}
					<StatusBadge {status} />
					<Button variant="outline" size="sm">Record payment</Button>
					<Button size="sm">Send</Button>
				{/snippet}
			</PageHeader>

			<div class="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.15fr)]">
				<div class="space-y-6">
					<section
						class="bg-card space-y-4 rounded-3xl p-5 ring-1 ring-foreground/5 dark:ring-foreground/10"
					>
						<h2 class="text-sm font-semibold tracking-tight">Invoice details</h2>
						<InvoiceForm form={invoiceForm} submitLabel="Save details" />
					</section>

					<section
						class="bg-card space-y-4 rounded-3xl p-5 ring-1 ring-foreground/5 dark:ring-foreground/10"
					>
						<div>
							<h2 class="text-sm font-semibold tracking-tight">Add line item</h2>
							<p class="text-muted-foreground text-xs">
								Link inventory/catalog products (1→many) or free-text lines.
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

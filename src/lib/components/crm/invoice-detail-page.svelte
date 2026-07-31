<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { InvoiceFormData } from '$lib/schemas/invoice.js';
	import type { CatalogProductOption, LineItemFormData } from '$lib/schemas/line-item.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import InvoiceForm from './invoice-form.svelte';
	import LineItemFormDrawer from './line-item-form-drawer.svelte';
	import LineItemsTable, { type LineItemRow } from './line-items-table.svelte';
	import Timeline, { type TimelineEvent } from './timeline.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import PlusIcon from '@lucide/svelte/icons/plus';

	export interface InvoiceDetailPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		title: string;
		status: string;
		invoiceForm: SuperForm<InvoiceFormData>;
		lineForm: SuperForm<LineItemFormData>;
		products?: CatalogProductOption[];
		lines?: LineItemRow[];
		timelineEvents?: TimelineEvent[];
		lineDrawerOpen?: boolean;
		onRemoveLine?: (id: string) => void;
		onSend?: () => void;
		onChase?: () => void;
		onRecordPayment?: () => void;
		class?: string;
	}

	let {
		orgName,
		navGroups,
		title,
		status = 'Draft',
		invoiceForm,
		lineForm,
		products = [],
		lines = $bindable<LineItemRow[]>([]),
		timelineEvents = [],
		lineDrawerOpen = $bindable(false),
		onRemoveLine,
		onSend,
		onChase,
		onRecordPayment,
		class: className
	}: InvoiceDetailPageProps = $props();
</script>

<div class={cn('bg-background text-foreground flex h-full min-h-[720px]', className)}>
	<AppNav {orgName} groups={navGroups} class="shrink-0" />

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-6 py-6 md:px-8">
			<PageHeader
				breadcrumb="Accounting / Invoices"
				{title}
				{status}
				description="Header + lines, with chase / payment activity on the right."
			>
				{#snippet actions()}
					<Button variant="outline" size="sm" onclick={() => onRecordPayment?.()}>
						Record payment
					</Button>
					<Button variant="outline" size="sm" onclick={() => onChase?.()}>Chase</Button>
					<Button size="sm" onclick={() => onSend?.()}>Send</Button>
				{/snippet}
			</PageHeader>

			<div
				class="grid items-start gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(260px,0.7fr)]"
			>
				<section
					class="bg-card self-start space-y-4 rounded-3xl p-5 ring-1 ring-foreground/5 dark:ring-foreground/10"
				>
					<h2 class="text-sm font-semibold tracking-tight">Invoice details</h2>
					<InvoiceForm form={invoiceForm} submitLabel="Save details" />
				</section>

				<LineItemsTable rows={lines} onRemove={onRemoveLine} class="self-start">
					{#snippet headerActions()}
						<LineItemFormDrawer bind:open={lineDrawerOpen} form={lineForm} {products}>
							{#snippet trigger()}
								<Button type="button" size="sm">
									<PlusIcon class="size-3.5" />
									Add line item
								</Button>
							{/snippet}
						</LineItemFormDrawer>
					{/snippet}
				</LineItemsTable>

				<Timeline
					events={timelineEvents}
					title="Activity"
					emptyMessage="No invoice activity yet."
					class="bg-card self-start rounded-3xl p-4 ring-1 ring-foreground/5 dark:ring-foreground/10"
				/>
			</div>
		</div>
	</main>
</div>

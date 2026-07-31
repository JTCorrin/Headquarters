<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { QuoteFormData } from '$lib/schemas/quote.js';
	import type { CatalogProductOption, LineItemFormData } from '$lib/schemas/line-item.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import QuoteForm from './quote-form.svelte';
	import LineItemFormDrawer from './line-item-form-drawer.svelte';
	import LineItemsTable, { type LineItemRow } from './line-items-table.svelte';
	import Timeline, { type TimelineEvent } from './timeline.svelte';
	import StatusBadge from './status-badge.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import PlusIcon from '@lucide/svelte/icons/plus';

	export interface QuoteDetailPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		title: string;
		status: string;
		quoteForm: SuperForm<QuoteFormData>;
		lineForm: SuperForm<LineItemFormData>;
		products?: CatalogProductOption[];
		lines?: LineItemRow[];
		timelineEvents?: TimelineEvent[];
		lineDrawerOpen?: boolean;
		onRemoveLine?: (id: string) => void;
		onSend?: () => void;
		onChase?: () => void;
		onConvert?: () => void;
		class?: string;
	}

	let {
		orgName,
		navGroups,
		title,
		status = 'Draft',
		quoteForm,
		lineForm,
		products = [],
		lines = $bindable<LineItemRow[]>([]),
		timelineEvents = [],
		lineDrawerOpen = $bindable(false),
		onRemoveLine,
		onSend,
		onChase,
		onConvert,
		class: className
	}: QuoteDetailPageProps = $props();
</script>

<div class={cn('bg-background text-foreground flex h-full min-h-[720px]', className)}>
	<AppNav {orgName} groups={navGroups} class="shrink-0" />

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-6 py-6 md:px-8">
			<PageHeader
				breadcrumb="Accounting / Quotes"
				{title}
				description="Header + lines, with activity for sends, views, and chases."
			>
				{#snippet actions()}
					<StatusBadge {status} />
					<Button variant="outline" size="sm" onclick={() => onSend?.()}>Send</Button>
					<Button variant="outline" size="sm" onclick={() => onChase?.()}>Chase</Button>
					<Button size="sm" onclick={() => onConvert?.()}>Convert to invoice</Button>
				{/snippet}
			</PageHeader>

			<div class="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(260px,0.7fr)]">
				<section
					class="bg-card space-y-4 rounded-3xl p-5 ring-1 ring-foreground/5 dark:ring-foreground/10"
				>
					<h2 class="text-sm font-semibold tracking-tight">Quote details</h2>
					<QuoteForm form={quoteForm} submitLabel="Save details" />
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
					emptyMessage="No quote activity yet."
					class="bg-card self-start rounded-3xl p-4 ring-1 ring-foreground/5 dark:ring-foreground/10"
				/>
			</div>
		</div>
	</main>
</div>

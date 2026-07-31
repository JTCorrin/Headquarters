<script lang="ts">
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import InfoCard, { type InfoCardField } from './info-card.svelte';
	import StatusBadge from './status-badge.svelte';
	import StatCard from './stat-card.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface ProductUsageRow {
		id: string;
		kind: 'quote' | 'invoice';
		label: string;
		clientName: string;
		qty: string;
		amount: string;
		status: string;
	}

	export interface ProductDetailPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		sku: string;
		name: string;
		status: string;
		description?: string;
		detailFields: InfoCardField[];
		inventoryFields?: InfoCardField[];
		usage?: ProductUsageRow[];
		stats?: { label: string; value: string; hint?: string }[];
		class?: string;
	}

	let {
		orgName,
		navGroups,
		sku,
		name,
		status,
		description,
		detailFields,
		inventoryFields = [],
		usage = [],
		stats = [],
		class: className
	}: ProductDetailPageProps = $props();
</script>

<div class={cn('bg-background text-foreground flex h-full min-h-[720px]', className)}>
	<AppNav {orgName} groups={navGroups} class="shrink-0" />

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-6 py-6 md:px-8">
			<PageHeader
				breadcrumb="Products / {sku}"
				title={name}
				description={description ?? 'Catalog item used on quote and invoice lines.'}
				{status}
			>
				{#snippet actions()}
					<Button variant="outline" size="sm">Duplicate</Button>
					<Button size="sm">Edit</Button>
				{/snippet}
			</PageHeader>

			{#if stats.length}
				<div class="grid gap-3 sm:grid-cols-3">
					{#each stats as stat (stat.label)}
						<StatCard label={stat.label} value={stat.value} hint={stat.hint} />
					{/each}
				</div>
			{/if}

			<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
				<div class="space-y-4">
					<InfoCard title="Details" fields={detailFields} />
					{#if inventoryFields.length}
						<InfoCard title="Inventory" fields={inventoryFields} />
					{/if}
				</div>

				<section class="space-y-3">
					<div>
						<h3 class="text-sm font-semibold tracking-tight">Used on</h3>
						<p class="text-muted-foreground text-xs">
							Recent quote and invoice lines referencing this SKU.
						</p>
					</div>
					{#if usage.length === 0}
						<p
							class="text-muted-foreground rounded-2xl px-4 py-8 text-center text-sm ring-1 ring-foreground/5"
						>
							Not on any open documents yet.
						</p>
					{:else}
						<ul class="divide-border divide-y rounded-2xl ring-1 ring-foreground/5">
							{#each usage as row (row.id)}
								<li class="flex items-start justify-between gap-3 px-4 py-3">
									<div class="min-w-0">
										<p class="truncate text-sm font-medium">{row.label}</p>
										<p class="text-muted-foreground truncate text-xs">
											{row.clientName} · qty {row.qty} · {row.amount}
										</p>
									</div>
									<div class="flex shrink-0 flex-col items-end gap-1">
										<span class="text-muted-foreground text-[10px] tracking-wide uppercase"
											>{row.kind}</span
										>
										<StatusBadge status={row.status} />
									</div>
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			</div>
		</div>
	</main>
</div>

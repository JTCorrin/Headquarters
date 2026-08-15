<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { BillFormData, BillListItem, BillVendorOption } from '$lib/schemas/bill.js';
	import { type AppNavGroup } from './app-nav.svelte';
	import AppSidebarFrame from './app-sidebar-frame.svelte';
	import PageHeader from './page-header.svelte';
	import BillsTable from './bills-table.svelte';
	import BillFormDrawer from './bill-form-drawer.svelte';
	import VendorFormDrawer from './vendor-form-drawer.svelte';
	import ListFilterBanner from './list-filter-banner.svelte';
	import type { SuperForm as VendorSuperForm } from 'sveltekit-superforms';
	import type { VendorFormData } from '$lib/schemas/vendor.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { cn } from '$lib/utils.js';

	export interface BillsListPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		rows: BillListItem[];
		form: SuperForm<BillFormData>;
		vendorForm?: VendorSuperForm<VendorFormData>;
		drawerOpen?: boolean;
		vendorDrawerOpen?: boolean;
		vendorOptions?: BillVendorOption[];
		selectedVendorId?: string | null;
		filterLabel?: string | null;
		onVendorFilterChange?: (vendorId: string | null) => void;
		onClearFilter?: () => void;
		/** When false, omit AppNav (shell already renders it at full window height). */
		showNav?: boolean;
		class?: string;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
		onCreateVendor?: () => void;
		onValidVendorCreate?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		orgName,
		navGroups,
		rows,
		form,
		vendorForm,
		drawerOpen = $bindable(false),
		vendorDrawerOpen = $bindable(false),
		vendorOptions = [],
		selectedVendorId = null,
		filterLabel = null,
		onVendorFilterChange,
		onClearFilter,
		showNav = true,
		class: className,
		onValidSubmit,
		onCreateVendor,
		onValidVendorCreate
	}: BillsListPageProps = $props();
</script>

<AppSidebarFrame
	{orgName}
	groups={navGroups}
	{showNav}
	showTrigger={showNav}
	class={cn(
		showNav ? 'h-full min-h-svh' : 'min-h-0 flex-1 flex-col',
		className
	)}
>

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-4 py-6 sm:px-6 md:px-8">
			<PageHeader
				breadcrumb="Accounting"
				title="Bills"
				description="Vendor bills you receive — accounts payable."
			>
				{#snippet actions()}
					<BillFormDrawer
						bind:open={drawerOpen}
						{form}
						{vendorOptions}
						{onValidSubmit}
						onCreateVendor={() => {
							onCreateVendor?.();
							vendorDrawerOpen = true;
						}}
					/>
				{/snippet}
			</PageHeader>

			{#if onVendorFilterChange}
				<div class="flex flex-wrap items-end gap-3">
					<div class="space-y-1.5">
						<Label for="bills-vendor-filter">Vendor</Label>
						<select
							id="bills-vendor-filter"
							class="border-input bg-background h-9 min-w-[12rem] rounded-md border px-3 text-sm"
							data-testid="bills-vendor-filter"
							value={selectedVendorId ?? ''}
							onchange={(event) => {
								const value = (event.currentTarget as HTMLSelectElement).value;
								onVendorFilterChange(value || null);
							}}
						>
							<option value="">All vendors</option>
							{#each vendorOptions as vendor (vendor.id)}
								<option value={vendor.id}>{vendor.name}</option>
							{/each}
						</select>
					</div>
				</div>
			{/if}

			{#if filterLabel}
				<ListFilterBanner label={filterLabel} onClear={onClearFilter} />
			{/if}

			<BillsTable {rows} />
		</div>
	</main>
</AppSidebarFrame>

{#if vendorForm}
	<VendorFormDrawer
		bind:open={vendorDrawerOpen}
		form={vendorForm}
		showTrigger={false}
		onValidSubmit={onValidVendorCreate}
	/>
{/if}

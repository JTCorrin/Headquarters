<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { BillFormData, BillListItem, BillVendorOption } from '$lib/schemas/bill.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import BillsTable from './bills-table.svelte';
	import BillFormDrawer from './bill-form-drawer.svelte';
	import VendorFormDrawer from './vendor-form-drawer.svelte';
	import type { SuperForm as VendorSuperForm } from 'sveltekit-superforms';
	import type { VendorFormData } from '$lib/schemas/vendor.js';
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
		showNav = true,
		class: className,
		onValidSubmit,
		onCreateVendor,
		onValidVendorCreate
	}: BillsListPageProps = $props();
</script>

<div
	class={cn(
		'bg-background text-foreground flex',
		showNav ? 'h-full min-h-svh' : 'min-h-0 flex-1 flex-col',
		className
	)}
>
	{#if showNav}
		<AppNav {orgName} groups={navGroups} class="h-full shrink-0 self-stretch" />
	{/if}

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-6 py-6 md:px-8">
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

			<BillsTable {rows} />
		</div>
	</main>
</div>

{#if vendorForm}
	<VendorFormDrawer
		bind:open={vendorDrawerOpen}
		form={vendorForm}
		showTrigger={false}
		onValidSubmit={onValidVendorCreate}
	/>
{/if}

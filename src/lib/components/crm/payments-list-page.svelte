<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type {
		PaymentBillOption,
		PaymentClientOption,
		PaymentFormData,
		PaymentInvoiceOption,
		PaymentListItem,
		PaymentVendorOption
	} from '$lib/schemas/payment.js';
	import { type AppNavGroup } from './app-nav.svelte';
	import AppSidebarFrame from './app-sidebar-frame.svelte';
	import PageHeader from './page-header.svelte';
	import PaymentsTable from './payments-table.svelte';
	import PaymentFormDrawer from './payment-form-drawer.svelte';
	import { cn } from '$lib/utils.js';

	export interface PaymentsListPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		rows: PaymentListItem[];
		form: SuperForm<PaymentFormData>;
		clientOptions?: PaymentClientOption[];
		vendorOptions?: PaymentVendorOption[];
		invoiceOptions?: PaymentInvoiceOption[];
		billOptions?: PaymentBillOption[];
		drawerOpen?: boolean;
		showNav?: boolean;
		class?: string;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		orgName,
		navGroups,
		rows,
		form,
		clientOptions = [],
		vendorOptions = [],
		invoiceOptions = [],
		billOptions = [],
		drawerOpen = $bindable(false),
		showNav = true,
		class: className,
		onValidSubmit
	}: PaymentsListPageProps = $props();
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
				title="Payments"
				description="Money in and out — allocate to invoices or bills, or leave unallocated."
			>
				{#snippet actions()}
					<PaymentFormDrawer
						bind:open={drawerOpen}
						{form}
						{clientOptions}
						{vendorOptions}
						{invoiceOptions}
						{billOptions}
						{onValidSubmit}
						triggerLabel="Record payment"
					/>
				{/snippet}
			</PageHeader>

			<PaymentsTable {rows} />
		</div>
	</main>
</AppSidebarFrame>

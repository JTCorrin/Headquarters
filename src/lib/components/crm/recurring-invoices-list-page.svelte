<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type {
		RecurringInvoiceClientOption,
		RecurringInvoiceContactOption,
		RecurringInvoiceFormData
	} from '$lib/schemas/recurring-invoice.js';
	import type { RecurringInvoiceRow } from './recurring-invoices-columns.js';
	import { type AppNavGroup } from './app-nav.svelte';
	import AppSidebarFrame from './app-sidebar-frame.svelte';
	import PageHeader from './page-header.svelte';
	import RecurringInvoicesTable from './recurring-invoices-table.svelte';
	import RecurringInvoiceFormDrawer from './recurring-invoice-form-drawer.svelte';
	import { cn } from '$lib/utils.js';

	export interface RecurringInvoicesListPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		rows: RecurringInvoiceRow[];
		form: SuperForm<RecurringInvoiceFormData>;
		drawerOpen?: boolean;
		clientOptions?: RecurringInvoiceClientOption[];
		contactOptions?: RecurringInvoiceContactOption[];
		showNav?: boolean;
		class?: string;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		orgName,
		navGroups,
		rows,
		form,
		drawerOpen = $bindable(false),
		clientOptions = [],
		contactOptions = [],
		showNav = true,
		class: className,
		onValidSubmit
	}: RecurringInvoicesListPageProps = $props();
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
				title="Recurring invoices"
				description="Templates that generate invoices on a schedule. Auto-send emails the PDF when organisation invoice email is configured."
			>
				{#snippet actions()}
					<RecurringInvoiceFormDrawer
						bind:open={drawerOpen}
						{form}
						{clientOptions}
						{contactOptions}
						{onValidSubmit}
						triggerLabel="New schedule"
					/>
				{/snippet}
			</PageHeader>

			<RecurringInvoicesTable {rows} />
		</div>
	</main>
</AppSidebarFrame>

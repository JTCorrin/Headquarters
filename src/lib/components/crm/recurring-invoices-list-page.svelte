<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type {
		RecurringInvoiceClientOption,
		RecurringInvoiceContactOption,
		RecurringInvoiceFormData
	} from '$lib/schemas/recurring-invoice.js';
	import type { RecurringInvoiceRow } from './recurring-invoices-columns.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
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
				title="Recurring invoices"
				description="Templates that generate draft invoices on a schedule. Auto-send is stored only in this slice."
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
</div>

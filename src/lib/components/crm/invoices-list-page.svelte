<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type {
		InvoiceClientOption,
		InvoiceContactOption,
		InvoiceFormData,
		InvoiceQuoteOption
	} from '$lib/schemas/invoice.js';
	import { type AppNavGroup } from './app-nav.svelte';
	import AppSidebarFrame from './app-sidebar-frame.svelte';
	import PageHeader from './page-header.svelte';
	import InvoicesTable from './invoices-table.svelte';
	import type { InvoiceRow } from './invoices-columns.js';
	import InvoiceFormDrawer from './invoice-form-drawer.svelte';
	import { cn } from '$lib/utils.js';

	export interface InvoicesListPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		rows: InvoiceRow[];
		form: SuperForm<InvoiceFormData>;
		drawerOpen?: boolean;
		clientOptions?: InvoiceClientOption[];
		contactOptions?: InvoiceContactOption[];
		quoteOptions?: InvoiceQuoteOption[];
		/** When false, omit AppNav (shell already renders it at full window height). */
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
		quoteOptions = [],
		showNav = true,
		class: className,
		onValidSubmit
	}: InvoicesListPageProps = $props();
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
				title="Invoices"
				description="Draft, send, and void invoices. Payments come later."
			>
				{#snippet actions()}
					<InvoiceFormDrawer
						bind:open={drawerOpen}
						{form}
						{clientOptions}
						{contactOptions}
						{quoteOptions}
						{onValidSubmit}
						triggerLabel="New invoice"
					/>
				{/snippet}
			</PageHeader>

			<InvoicesTable {rows} />
		</div>
	</main>
</AppSidebarFrame>

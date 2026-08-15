<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type {
		QuoteClientOption,
		QuoteContactOption,
		QuoteFormData
	} from '$lib/schemas/quote.js';
	import { type AppNavGroup } from './app-nav.svelte';
	import AppSidebarFrame from './app-sidebar-frame.svelte';
	import PageHeader from './page-header.svelte';
	import QuotesTable from './quotes-table.svelte';
	import type { QuoteRow } from './quotes-columns.js';
	import QuoteFormDrawer from './quote-form-drawer.svelte';
	import { cn } from '$lib/utils.js';

	export interface QuotesListPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		rows: QuoteRow[];
		form: SuperForm<QuoteFormData>;
		drawerOpen?: boolean;
		clientOptions?: QuoteClientOption[];
		contactOptions?: QuoteContactOption[];
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
		showNav = true,
		class: className,
		onValidSubmit
	}: QuotesListPageProps = $props();
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
				title="Quotes"
				description="Draft, send, and convert quotes into invoices."
			>
				{#snippet actions()}
					<QuoteFormDrawer
						bind:open={drawerOpen}
						{form}
						{clientOptions}
						{contactOptions}
						{onValidSubmit}
						triggerLabel="New quote"
					/>
				{/snippet}
			</PageHeader>

			<QuotesTable {rows} />
		</div>
	</main>
</AppSidebarFrame>

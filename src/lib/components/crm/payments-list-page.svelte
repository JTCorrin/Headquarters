<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { PaymentFormData } from '$lib/schemas/payment.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import PaymentsTable from './payments-table.svelte';
	import type { PaymentRow } from './payments-columns.js';
	import PaymentFormDrawer from './payment-form-drawer.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface PaymentsListPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		rows: PaymentRow[];
		form: SuperForm<PaymentFormData>;
		drawerOpen?: boolean;
		class?: string;
	}

	let {
		orgName,
		navGroups,
		rows,
		form,
		drawerOpen = $bindable(false),
		class: className
	}: PaymentsListPageProps = $props();
</script>

<div class={cn('bg-background text-foreground flex h-full min-h-[720px]', className)}>
	<AppNav {orgName} groups={navGroups} class="shrink-0" />

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-6 py-6 md:px-8">
			<PageHeader
				breadcrumb="Accounting"
				title="Payments"
				description="Incoming money — match to invoices or leave unallocated."
			>
				{#snippet actions()}
					<PaymentFormDrawer bind:open={drawerOpen} {form}>
						{#snippet trigger()}
							<Button type="button" size="sm">Record payment</Button>
						{/snippet}
					</PaymentFormDrawer>
				{/snippet}
			</PageHeader>

			<PaymentsTable {rows} />
		</div>
	</main>
</div>

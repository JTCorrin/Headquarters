<script lang="ts">
	import { fromStore } from 'svelte/store';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { BillFormData } from '$lib/schemas/bill.js';
	import type { CatalogProductOption, LineItemFormData } from '$lib/schemas/line-item.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import BillForm from './bill-form.svelte';
	import LineItemFormDrawer from './line-item-form-drawer.svelte';
	import LineItemsTable, { type LineItemRow } from './line-items-table.svelte';
	import Timeline, { type TimelineEvent } from './timeline.svelte';
	import DocumentPdfPreview from './document-pdf-preview.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import {
		buildMoneyDocumentDef,
		moneyDocumentFilename
	} from '$lib/pdf/money-document.js';
	import PlusIcon from '@lucide/svelte/icons/plus';

	export interface BillDetailPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		title: string;
		status: string;
		billForm: SuperForm<BillFormData>;
		lineForm: SuperForm<LineItemFormData>;
		products?: CatalogProductOption[];
		lines?: LineItemRow[];
		timelineEvents?: TimelineEvent[];
		lineDrawerOpen?: boolean;
		onRemoveLine?: (id: string) => void;
		onSchedule?: () => void;
		onMarkPaid?: () => void;
		onRecordPayment?: () => void;
		class?: string;
	}

	let {
		orgName,
		navGroups,
		title,
		status = 'Received',
		billForm,
		lineForm,
		products = [],
		lines = $bindable<LineItemRow[]>([]),
		timelineEvents = $bindable<TimelineEvent[]>([]),
		lineDrawerOpen = $bindable(false),
		onRemoveLine,
		onSchedule,
		onMarkPaid,
		onRecordPayment,
		class: className
	}: BillDetailPageProps = $props();

	const formData = fromStore(billForm.form);

	const pdfDocument = $derived(
		buildMoneyDocumentDef({
			kind: 'bill',
			orgName,
			partyLabel: 'Vendor',
			partyName: formData.current.vendorName,
			documentNumber: formData.current.number || title.split('·')[0]?.trim() || 'Bill',
			currency: formData.current.currency,
			status: status || formData.current.status,
			dueOn: formData.current.dueOn,
			lines,
			issueDate: new Date().toISOString().slice(0, 10)
		})
	);

	const pdfFilename = $derived(
		moneyDocumentFilename({
			kind: 'bill',
			orgName,
			partyLabel: 'Vendor',
			partyName: formData.current.vendorName,
			documentNumber: formData.current.number || 'bill',
			currency: formData.current.currency,
			status,
			lines
		})
	);
</script>

<div class={cn('bg-background text-foreground flex h-full min-h-[720px]', className)}>
	<AppNav {orgName} groups={navGroups} class="shrink-0" />

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-6 py-6 md:px-8">
			<PageHeader
				breadcrumb="Accounting / Bills"
				{title}
				{status}
				description="Edit on the left — the PDF preview updates live on the right."
			>
				{#snippet actions()}
					<Button variant="outline" size="sm" onclick={() => onSchedule?.()}>Schedule</Button>
					<Button variant="outline" size="sm" onclick={() => onRecordPayment?.()}>
						Record payment
					</Button>
					<Button size="sm" onclick={() => onMarkPaid?.()}>Mark paid</Button>
				{/snippet}
			</PageHeader>

			<div class="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.95fr)]">
				<div class="space-y-6">
					<section
						class="bg-card self-start space-y-4 rounded-3xl p-5 ring-1 ring-foreground/5 dark:ring-foreground/10"
					>
						<h2 class="text-sm font-semibold tracking-tight">Bill details</h2>
						<BillForm form={billForm} submitLabel="Save details" />
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
						bind:events={timelineEvents}
						title="Activity"
						composable
						composerActor="Joe"
						emptyMessage="No bill activity yet."
						class="bg-card self-start rounded-3xl p-4 ring-1 ring-foreground/5 dark:ring-foreground/10"
					/>
				</div>

				<DocumentPdfPreview
					document={pdfDocument}
					filename={pdfFilename}
					title="Bill PDF"
					class="xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)]"
				/>
			</div>
		</div>
	</main>
</div>

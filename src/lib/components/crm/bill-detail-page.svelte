<script lang="ts">
	import { fromStore } from 'svelte/store';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { BillFormData, BillVendorOption } from '$lib/schemas/bill.js';
	import type { CatalogProductOption, LineItemFormData } from '$lib/schemas/line-item.js';
	import type {
		PaymentBillOption,
		PaymentFormData,
		PaymentListItem,
		PaymentVendorOption
	} from '$lib/schemas/payment.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import BillForm from './bill-form.svelte';
	import LineItemFormDrawer from './line-item-form-drawer.svelte';
	import LineItemsTable, { type LineItemRow } from './line-items-table.svelte';
	import DocumentPaymentsPanel from './document-payments-panel.svelte';
	import Timeline, { type TimelineEvent } from './timeline.svelte';
	import type { TimelineComposerSubmit } from './timeline-composer.svelte';
	import DocumentPdfPreview from './document-pdf-preview.svelte';
	import VendorFormDrawer from './vendor-form-drawer.svelte';
	import type { SuperForm as VendorSuperForm } from 'sveltekit-superforms';
	import type { VendorFormData } from '$lib/schemas/vendor.js';
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
		vendorForm?: VendorSuperForm<VendorFormData>;
		products?: CatalogProductOption[];
		vendorOptions?: BillVendorOption[];
		lines?: LineItemRow[];
		timelineEvents?: TimelineEvent[];
		composerActor?: string;
		lineDrawerOpen?: boolean;
		vendorDrawerOpen?: boolean;
		isDraft?: boolean;
		isDirty?: boolean;
		actionPending?: boolean;
		moneyTotals?: {
			subtotalCents: number;
			discountCents: number;
			taxCents: number;
			totalCents: number;
		} | null;
		paymentForm?: SuperForm<PaymentFormData>;
		paymentRows?: PaymentListItem[];
		paymentVendorOptions?: PaymentVendorOption[];
		paymentBillOptions?: PaymentBillOption[];
		paymentDrawerOpen?: boolean;
		paidLabel?: string;
		balanceLabel?: string;
		canRecordPayment?: boolean;
		onRemoveLine?: (id: string) => void;
		onAddLine?: () => boolean | void | Promise<boolean | void>;
		onSaveBill?: () => boolean | void | Promise<boolean | void>;
		onReceive?: () => void | Promise<void>;
		onVoid?: () => void | Promise<void>;
		onDelete?: () => void | Promise<void>;
		onCreateVendor?: () => void;
		onValidVendorCreate?: () => boolean | void | Promise<boolean | void>;
		onRecordPayment?: () => boolean | void | Promise<boolean | void>;
		onReversePayment?: (paymentId: string) => void | Promise<void>;
		onTimelineAdd?: (event: TimelineComposerSubmit) => void | Promise<void>;
		showNav?: boolean;
		class?: string;
	}

	let {
		orgName,
		navGroups,
		title,
		status = 'Received',
		billForm,
		lineForm,
		vendorForm,
		products = [],
		vendorOptions = [],
		lines = $bindable<LineItemRow[]>([]),
		timelineEvents = $bindable<TimelineEvent[]>([]),
		composerActor = 'You',
		lineDrawerOpen = $bindable(false),
		vendorDrawerOpen = $bindable(false),
		isDraft = true,
		isDirty = false,
		actionPending = false,
		moneyTotals = null,
		paymentForm,
		paymentRows = [],
		paymentVendorOptions = [],
		paymentBillOptions = [],
		paymentDrawerOpen = $bindable(false),
		paidLabel = '—',
		balanceLabel = '—',
		canRecordPayment = false,
		onRemoveLine,
		onAddLine,
		onSaveBill,
		onReceive,
		onVoid,
		onDelete,
		onCreateVendor,
		onValidVendorCreate,
		onRecordPayment,
		onReversePayment,
		onTimelineAdd,
		showNav = true,
		class: className
	}: BillDetailPageProps = $props();

	const formData = fromStore(billForm.form);
	const statusLower = $derived(status.toLowerCase());

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
			issueDate: formData.current.issueOn || formData.current.receivedOn || new Date().toISOString().slice(0, 10),
			totals: moneyTotals
				? {
						subtotalCents: moneyTotals.subtotalCents,
						discountCents: moneyTotals.discountCents,
						taxCents: moneyTotals.taxCents,
						totalCents: moneyTotals.totalCents
					}
				: undefined
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
				breadcrumb="Accounting / Bills"
				{title}
				{status}
				description="Edit on the left — the PDF preview updates live on the right."
			>
				{#snippet actions()}
					{#if isDraft}
						<Button
							variant="outline"
							size="sm"
							disabled={actionPending}
							onclick={() => onDelete?.()}
						>
							Delete draft
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={actionPending}
							onclick={() => onVoid?.()}
						>
							Void
						</Button>
						<Button
							size="sm"
							disabled={actionPending || isDirty}
							title={isDirty ? 'Save your changes before receiving' : undefined}
							onclick={() => onReceive?.()}
						>
							Receive
						</Button>
					{:else if statusLower === 'received'}
						<Button
							variant="outline"
							size="sm"
							disabled={actionPending}
							onclick={() => onVoid?.()}
						>
							Void
						</Button>
					{/if}
				{/snippet}
			</PageHeader>

			<div class="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.95fr)]">
				<div class="space-y-6">
					<section
						class="bg-card self-start space-y-4 rounded-3xl p-5 ring-1 ring-foreground/5 dark:ring-foreground/10"
					>
						<h2 class="text-sm font-semibold tracking-tight">Bill details</h2>
						{#if isDraft && isDirty}
							<p class="text-muted-foreground text-xs" data-testid="bill-dirty-hint">
								Unsaved changes — save before receiving.
							</p>
						{/if}
						<BillForm
							form={billForm}
							submitLabel="Save details"
							{vendorOptions}
							readonly={!isDraft}
							onValidSubmit={onSaveBill}
							onCreateVendor={() => {
								onCreateVendor?.();
								vendorDrawerOpen = true;
							}}
						/>
					</section>

					<LineItemsTable
						rows={lines}
						totals={moneyTotals}
						onRemove={isDraft ? onRemoveLine : undefined}
						class="self-start"
					>
						{#snippet headerActions()}
							{#if isDraft}
								<LineItemFormDrawer
									bind:open={lineDrawerOpen}
									form={lineForm}
									{products}
									onValidSubmit={onAddLine}
								>
									{#snippet trigger()}
										<Button type="button" size="sm">
											<PlusIcon class="size-3.5" />
											Add line item
										</Button>
									{/snippet}
								</LineItemFormDrawer>
							{/if}
						{/snippet}
					</LineItemsTable>

					{#if paymentForm}
						<DocumentPaymentsPanel
							{status}
							{paidLabel}
							{balanceLabel}
							rows={paymentRows}
							form={paymentForm}
							vendorOptions={paymentVendorOptions}
							billOptions={paymentBillOptions}
							bind:drawerOpen={paymentDrawerOpen}
							{actionPending}
							canRecord={canRecordPayment}
							onValidSubmit={onRecordPayment}
							onReverse={onReversePayment}
						/>
					{/if}

					<Timeline
						bind:events={timelineEvents}
						title="Activity"
						composable
						{composerActor}
						onAdd={onTimelineAdd}
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

{#if vendorForm}
	<VendorFormDrawer
		bind:open={vendorDrawerOpen}
		form={vendorForm}
		showTrigger={false}
		onValidSubmit={onValidVendorCreate}
	/>
{/if}

<script lang="ts">
	import { fromStore } from 'svelte/store';
	import type { SuperForm } from 'sveltekit-superforms';
	import type {
		InvoiceClientOption,
		InvoiceContactOption,
		InvoiceFormData
	} from '$lib/schemas/invoice.js';
	import type { CatalogProductOption, LineItemFormData } from '$lib/schemas/line-item.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import InvoiceForm from './invoice-form.svelte';
	import LineItemFormDrawer from './line-item-form-drawer.svelte';
	import LineItemsTable, { type LineItemRow } from './line-items-table.svelte';
	import Timeline, { type TimelineEvent } from './timeline.svelte';
	import DocumentPdfPreview from './document-pdf-preview.svelte';
	import AiSuggestionPanel, { type AiSuggestionStatus } from './ai-suggestion-panel.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import {
		buildMoneyDocumentDef,
		moneyDocumentFilename
	} from '$lib/pdf/money-document.js';
	import PlusIcon from '@lucide/svelte/icons/plus';

	export interface InvoiceDetailPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		title: string;
		status: string;
		invoiceForm: SuperForm<InvoiceFormData>;
		lineForm: SuperForm<LineItemFormData>;
		products?: CatalogProductOption[];
		lines?: LineItemRow[];
		timelineEvents?: TimelineEvent[];
		lineDrawerOpen?: boolean;
		clientOptions?: InvoiceClientOption[];
		contactOptions?: InvoiceContactOption[];
		isDraft?: boolean;
		/** Unsaved header/line edits — Send stays disabled until saved. */
		isDirty?: boolean;
		/** Server-authoritative money totals for table/PDF (minor units). */
		moneyTotals?: {
			subtotalCents: number;
			discountCents: number;
			taxCents: number;
			totalCents: number;
		} | null;
		actionPending?: boolean;
		onRemoveLine?: (id: string) => void;
		onAddLine?: () => boolean | void | Promise<boolean | void>;
		onSaveInvoice?: () => boolean | void | Promise<boolean | void>;
		onSend?: () => void | Promise<void>;
		onVoid?: () => void | Promise<void>;
		onDelete?: () => void | Promise<void>;
		onChase?: (draft?: string) => void;
		/** When false, omit AppNav (shell already renders it at full window height). */
		showNav?: boolean;
		class?: string;
	}

	let {
		orgName,
		navGroups,
		title,
		status = 'Draft',
		invoiceForm,
		lineForm,
		products = [],
		lines = $bindable<LineItemRow[]>([]),
		timelineEvents = $bindable<TimelineEvent[]>([]),
		lineDrawerOpen = $bindable(false),
		clientOptions = [],
		contactOptions = [],
		isDraft = true,
		isDirty = false,
		moneyTotals = null,
		actionPending = false,
		onRemoveLine,
		onAddLine,
		onSaveInvoice,
		onSend,
		onVoid,
		onDelete,
		onChase,
		showNav = true,
		class: className
	}: InvoiceDetailPageProps = $props();

	const formData = fromStore(invoiceForm.form);

	let chaseOpen = $state(false);
	let chaseStatus = $state<AiSuggestionStatus>('idle');
	let chaseDraft = $state('');
	let chaseTone = $state('polite');

	function openChaseAssist() {
		chaseOpen = true;
		chaseStatus = 'idle';
		chaseDraft = '';
	}

	async function generateChaseDraft() {
		chaseStatus = 'generating';
		const client = formData.current.clientName || 'there';
		const due = formData.current.dueOn || 'the due date';
		const number = title.split('·')[0]?.trim() || 'this invoice';
		await new Promise((r) => setTimeout(r, 650));
		if (chaseTone === 'firm') {
			chaseDraft = `Hi ${client},\n\nInvoice ${number} is past due (due ${due}). Please arrange payment or reply with a remittance date this week.\n\nRegards`;
		} else {
			chaseDraft = `Hi ${client},\n\nFriendly reminder that invoice ${number} was due on ${due}. Happy to resend the PDF or set up a payment link if useful.\n\nThanks`;
		}
		chaseStatus = 'ready';
	}

	const pdfDocument = $derived(
		buildMoneyDocumentDef({
			kind: 'invoice',
			orgName,
			partyLabel: 'Bill to',
			partyName: formData.current.clientName,
			documentNumber: title.split('·')[0]?.trim() || 'Invoice',
			currency: formData.current.currency,
			status: status || formData.current.status,
			dueOn: formData.current.dueOn,
			lines,
			issueDate: formData.current.issueOn || new Date().toISOString().slice(0, 10),
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
			kind: 'invoice',
			orgName,
			partyLabel: 'Bill to',
			partyName: formData.current.clientName,
			documentNumber: title.split('·')[0]?.trim() || 'invoice',
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
				breadcrumb="Accounting / Invoices"
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
							title={isDirty ? 'Save your changes before sending' : undefined}
							onclick={() => onSend?.()}
						>
							Send
						</Button>
					{:else if status.toLowerCase() === 'sent'}
						<Button
							variant="outline"
							size="sm"
							onclick={() => {
								openChaseAssist();
								onChase?.();
							}}
						>
							Chase
						</Button>
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

			{#if chaseOpen}
				<AiSuggestionPanel
					title="Draft chase email"
					hint="Task assist on the invoice — edit, then use. Not a chat."
					bind:value={chaseDraft}
					bind:activeVariant={chaseTone}
					status={chaseStatus}
					generateLabel="Draft chase"
					useLabel="Use & log chase"
					variants={[
						{ id: 'polite', label: 'Polite' },
						{ id: 'firm', label: 'Firm' }
					]}
					onGenerate={generateChaseDraft}
					onVariantChange={(id) => {
						chaseTone = id;
						if (chaseStatus === 'ready') generateChaseDraft();
					}}
					onDiscard={() => {
						chaseOpen = false;
						chaseDraft = '';
						chaseStatus = 'idle';
					}}
					onUse={() => {
						onChase?.(chaseDraft);
						chaseOpen = false;
					}}
				/>
			{/if}

			<div class="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.95fr)]">
				<div class="space-y-6">
					<section
						class="bg-card self-start space-y-4 rounded-3xl p-5 ring-1 ring-foreground/5 dark:ring-foreground/10"
					>
						<h2 class="text-sm font-semibold tracking-tight">Invoice details</h2>
						{#if isDraft && isDirty}
							<p class="text-muted-foreground text-xs" data-testid="invoice-dirty-hint">
								Unsaved changes — save before sending.
							</p>
						{/if}
						<InvoiceForm
							form={invoiceForm}
							submitLabel="Save details"
							{clientOptions}
							{contactOptions}
							readonly={!isDraft}
							onValidSubmit={onSaveInvoice}
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

					<Timeline
						bind:events={timelineEvents}
						title="Activity"
						composable
						composerActor="Joe"
						emptyMessage="No invoice activity yet."
						class="bg-card self-start rounded-3xl p-4 ring-1 ring-foreground/5 dark:ring-foreground/10"
					/>
				</div>

				<DocumentPdfPreview
					document={pdfDocument}
					filename={pdfFilename}
					title="Invoice PDF"
					class="xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)]"
				/>
			</div>
		</div>
	</main>
</div>

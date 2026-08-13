<script lang="ts">
	import { fromStore } from 'svelte/store';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { QuoteContactOption, QuoteFormData } from '$lib/schemas/quote.js';
	import { attentionLineFromRecipients } from '$lib/schemas/document-recipients.js';
	import type { CatalogProductOption, LineItemFormData } from '$lib/schemas/line-item.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import QuoteForm from './quote-form.svelte';
	import LineItemFormDrawer from './line-item-form-drawer.svelte';
	import LineItemsTable, { type LineItemRow } from './line-items-table.svelte';
	import Timeline, { type TimelineEvent } from './timeline.svelte';
	import type { TimelineComposerSubmit } from './timeline-composer.svelte';
	import DocumentPdfPreview from './document-pdf-preview.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import {
		buildMoneyDocumentDef,
		moneyDocumentFilename
	} from '$lib/pdf/money-document.js';
	import PlusIcon from '@lucide/svelte/icons/plus';

	export interface QuoteDetailPageProps {
		orgName: string;
		orgLogoDataUrl?: string;
		orgAddressLines?: string[];
		navGroups: AppNavGroup[];
		title: string;
		status: string;
		quoteForm: SuperForm<QuoteFormData>;
		lineForm: SuperForm<LineItemFormData>;
		products?: CatalogProductOption[];
		lines?: LineItemRow[];
		timelineEvents?: TimelineEvent[];
		composerActor?: string;
		lineDrawerOpen?: boolean;
		canEditLines?: boolean;
		canSend?: boolean;
		canReject?: boolean;
		canAccept?: boolean;
		canConvert?: boolean;
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
		onSend?: () => void | Promise<void>;
		onReject?: () => void | Promise<void>;
		onAccept?: () => void | Promise<void>;
		onConvert?: () => void | Promise<void>;
		onDelete?: () => void | Promise<void>;
		onSaveQuote?: () => boolean | void | Promise<boolean | void>;
		onTimelineAdd?: (event: TimelineComposerSubmit) => void | Promise<void>;
		clientOptions?: import('$lib/schemas/quote.js').QuoteClientOption[];
		contactOptions?: QuoteContactOption[];
		readonly?: boolean;
		/** When false, omit AppNav (shell already renders it at full window height). */
		showNav?: boolean;
		class?: string;
	}

	let {
		orgName,
		orgLogoDataUrl,
		orgAddressLines = [],
		navGroups,
		title,
		status = 'Draft',
		quoteForm,
		lineForm,
		products = [],
		lines = $bindable<LineItemRow[]>([]),
		timelineEvents = $bindable<TimelineEvent[]>([]),
		composerActor = 'You',
		lineDrawerOpen = $bindable(false),
		canEditLines = true,
		canSend = false,
		canReject = false,
		canAccept = false,
		canConvert = false,
		moneyTotals = null,
		actionPending = false,
		onRemoveLine,
		onAddLine,
		onSend,
		onReject,
		onAccept,
		onConvert,
		onDelete,
		onSaveQuote,
		onTimelineAdd,
		clientOptions = [],
		contactOptions = [],
		readonly = false,
		showNav = true,
		class: className
	}: QuoteDetailPageProps = $props();

	const formData = fromStore(quoteForm.form);

	const attentionLine = $derived(
		attentionLineFromRecipients(formData.current.recipients, contactOptions)
	);

	const pdfDocument = $derived(
		buildMoneyDocumentDef({
			kind: 'quote',
			orgName,
			orgLogoDataUrl,
			orgAddressLines,
			partyLabel: 'Bill to',
			partyName: formData.current.clientName,
			attentionLine,
			documentNumber: title.split('·')[0]?.trim() || 'Quote',
			subtitle: formData.current.title,
			currency: formData.current.currency,
			status: status || formData.current.status,
			lines,
			issueDate: new Date().toISOString().slice(0, 10),
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
			kind: 'quote',
			orgName,
			partyLabel: 'Bill to',
			partyName: formData.current.clientName,
			documentNumber: title.split('·')[0]?.trim() || 'quote',
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
				breadcrumb="Accounting / Quotes"
				{title}
				{status}
				description="Edit on the left — the PDF preview updates live on the right. Lifecycle: Send or Accept, then Convert to invoice."
			>
				{#snippet actions()}
					{#if canSend}
						<Button
							size="sm"
							type="button"
							disabled={actionPending}
							data-testid="quote-send"
							onclick={() => void onSend?.()}
						>
							Send
						</Button>
					{/if}
					{#if canReject}
						<Button
							size="sm"
							type="button"
							variant="outline"
							disabled={actionPending}
							data-testid="quote-reject"
							onclick={() => void onReject?.()}
						>
							Reject
						</Button>
					{/if}
					{#if canAccept}
						<Button
							size="sm"
							type="button"
							variant={canSend ? 'outline' : 'default'}
							disabled={actionPending}
							data-testid="quote-accept"
							onclick={() => void onAccept?.()}
						>
							Accept
						</Button>
					{/if}
					{#if canConvert}
						<Button
							size="sm"
							type="button"
							disabled={actionPending}
							data-testid="quote-convert"
							onclick={() => void onConvert?.()}
						>
							Convert to invoice
						</Button>
					{:else if canAccept || canSend}
						<Button
							size="sm"
							type="button"
							variant="outline"
							disabled
							title="Accept the quote first, then convert."
							data-testid="quote-convert-disabled"
						>
							Convert to invoice
						</Button>
					{/if}
					{#if onDelete}
						<Button
							size="sm"
							type="button"
							variant="outline"
							disabled={actionPending}
							data-testid="quote-delete"
							onclick={() => void onDelete?.()}
						>
							Delete draft
						</Button>
					{/if}
				{/snippet}
			</PageHeader>

			<div class="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.95fr)]">
				<div class="space-y-6">
					<section
						class="bg-card self-start space-y-4 rounded-3xl p-5 ring-1 ring-foreground/5 dark:ring-foreground/10"
					>
						<h2 class="text-sm font-semibold tracking-tight">Quote details</h2>
						<QuoteForm
							form={quoteForm}
							submitLabel="Save details"
							{clientOptions}
							{contactOptions}
							{readonly}
							onValidSubmit={onSaveQuote}
						/>
					</section>

					<LineItemsTable
						rows={lines}
						totals={moneyTotals}
						onRemove={canEditLines ? onRemoveLine : undefined}
						class="self-start"
					>
						{#snippet headerActions()}
							{#if canEditLines}
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
						{composerActor}
						onAdd={onTimelineAdd}
						emptyMessage="No quote activity yet."
						class="bg-card self-start rounded-3xl p-4 ring-1 ring-foreground/5 dark:ring-foreground/10"
					/>
				</div>

				<DocumentPdfPreview
					document={pdfDocument}
					filename={pdfFilename}
					title="Quote PDF"
					class="xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)]"
				/>
			</div>
		</div>
	</main>
</div>

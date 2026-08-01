<script lang="ts">
	import { fromStore } from 'svelte/store';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { QuoteFormData } from '$lib/schemas/quote.js';
	import type { CatalogProductOption, LineItemFormData } from '$lib/schemas/line-item.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import QuoteForm from './quote-form.svelte';
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

	export interface QuoteDetailPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		title: string;
		status: string;
		quoteForm: SuperForm<QuoteFormData>;
		lineForm: SuperForm<LineItemFormData>;
		products?: CatalogProductOption[];
		lines?: LineItemRow[];
		timelineEvents?: TimelineEvent[];
		lineDrawerOpen?: boolean;
		onRemoveLine?: (id: string) => void;
		onSend?: () => void;
		onChase?: () => void;
		onConvert?: () => void;
		onSaveQuote?: () => boolean | void | Promise<boolean | void>;
		clientOptions?: import('$lib/schemas/quote.js').QuoteClientOption[];
		/** When false, omit AppNav (shell already renders it at full window height). */
		showNav?: boolean;
		class?: string;
	}

	let {
		orgName,
		navGroups,
		title,
		status = 'Draft',
		quoteForm,
		lineForm,
		products = [],
		lines = $bindable<LineItemRow[]>([]),
		timelineEvents = $bindable<TimelineEvent[]>([]),
		lineDrawerOpen = $bindable(false),
		onRemoveLine,
		onSend,
		onChase,
		onConvert,
		onSaveQuote,
		clientOptions = [],
		showNav = true,
		class: className
	}: QuoteDetailPageProps = $props();

	const formData = fromStore(quoteForm.form);

	const pdfDocument = $derived(
		buildMoneyDocumentDef({
			kind: 'quote',
			orgName,
			partyLabel: 'Bill to',
			partyName: formData.current.clientName,
			documentNumber: title.split('·')[0]?.trim() || 'Quote',
			subtitle: formData.current.title,
			currency: formData.current.currency,
			status: status || formData.current.status,
			lines,
			issueDate: new Date().toISOString().slice(0, 10)
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
				description="Edit on the left — the PDF preview updates live on the right."
			>
				{#snippet actions()}
					<Button variant="outline" size="sm" onclick={() => onSend?.()}>Send</Button>
					<Button variant="outline" size="sm" onclick={() => onChase?.()}>Chase</Button>
					<Button size="sm" onclick={() => onConvert?.()}>Convert to invoice</Button>
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
							onValidSubmit={onSaveQuote}
						/>
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

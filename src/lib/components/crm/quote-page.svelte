<script lang="ts">
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		roleFromMemberships,
		lineItemRowsToQuoteLineInputs,
		membershipFromCreateResult,
		quoteStatusLabel,
		toCatalogProductOption,
		toOrganisationCreateBody,
		toOrgMembershipSummary,
		toQuoteFormData,
		toQuoteLineInput,
		toQuoteUpdateBody
	} from '$lib/api/v1/mappers.js';
	import type { ApiQuoteDocument, ApiTaxRate } from '$lib/api/v1/types.js';
	import { centsToAmountString } from '$lib/money.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import {
		defaultTaxRatePercentString,
		lineItemFormSchema,
		type CatalogProductOption
	} from '$lib/schemas/line-item.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import { quoteFormSchema, type QuoteClientOption } from '$lib/schemas/quote.js';
	import type { LineItemRow } from './line-items-table.svelte';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import QuoteDetailPage from './quote-detail-page.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	export interface QuotePageProps {
		api: ApiV1Client;
		session: OrgSession;
		quoteId: string;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onConverted?: (invoiceId: string) => void;
		onLogout?: () => void | Promise<void>;
		class?: string;
	}

	let {
		api,
		session,
		quoteId,
		onMissingOrg,
		onSwitchNavigate,
		onConverted,
		onLogout,
		class: className
	}: QuotePageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let quote = $state<ApiQuoteDocument | null>(null);
	let clientOptions = $state<QuoteClientOption[]>([]);
	let products = $state<CatalogProductOption[]>([]);
	let taxRates = $state<ApiTaxRate[]>([]);
	let lines = $state<LineItemRow[]>([]);
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);
	let actionPending = $state(false);
	let lineDrawerOpen = $state(false);

	function emptyLineForm() {
		return {
			productId: '',
			description: '',
			qty: '1',
			unitPrice: '0',
			taxRatePercent: defaultTaxRatePercentString(taxRates)
		};
	}

	const quoteForm = superForm(
		defaults(
			{
				clientId: '00000000-0000-4000-8000-000000000000',
				clientName: '',
				title: '',
				currency: 'GBP' as const,
				status: 'draft' as const
			},
			zod4(quoteFormSchema)
		),
		{
			validators: zod4(quoteFormSchema),
			SPA: true,
			warnings: { duplicateId: false },
			applyAction: false,
			resetForm: false
		}
	);

	const lineForm = superForm(defaults(emptyLineForm(), zod4(lineItemFormSchema)), {
		validators: zod4(lineItemFormSchema),
		SPA: true,
		warnings: { duplicateId: false },
		applyAction: false,
		resetForm: false
	});

	const orgName = $derived(
		session.memberships.find((m) => m.org_id === session.selectedOrgId)?.org_name ??
			'Organisation'
	);
	const role = $derived(
		(roleFromMemberships(session.memberships, session.selectedOrgId) ??
			'member') as MembershipRole
	);
	const navGroups = $derived(appNavGroups('Quotes', role));
	const currentOrgId = $derived(session.selectedOrgId ?? '');
	const canEditLines = $derived(quote?.status === 'draft' || quote?.status === 'sent');
	const canAccept = $derived(quote?.status === 'draft' || quote?.status === 'sent');
	const canConvert = $derived(quote?.status === 'accepted');

	function userMessage(error: unknown, fallback: string): string {
		if (isApiClientError(error)) {
			if (error.isNetworkError) return 'Network error — check your connection and retry.';
			if (error.isForbidden) return error.message || 'You do not have permission for this action.';
			if (error.status === 404 || error.code === 'NOT_FOUND') return 'Quote not found.';
			if (error.isPreconditionFailed) {
				return error.message || 'Quote changed elsewhere — reload and try again.';
			}
			if (error.isValidationError) {
				if (error.fields) return Object.values(error.fields).join(' · ') || error.message;
				return error.message;
			}
			return error.message || fallback;
		}
		return fallback;
	}

	interface RequestEpoch {
		orgId: string | null;
		generation: number;
		quoteId: string;
	}

	const liveEpoch: RequestEpoch = {
		orgId: null,
		generation: -1,
		quoteId: ''
	};

	$effect(() => {
		liveEpoch.orgId = session.selectedOrgId;
		liveEpoch.generation = session.cacheGeneration;
		liveEpoch.quoteId = quoteId;
	});

	function captureEpoch(): RequestEpoch {
		return {
			orgId: liveEpoch.orgId,
			generation: liveEpoch.generation,
			quoteId: liveEpoch.quoteId
		};
	}

	function isStale(epoch: RequestEpoch): boolean {
		return (
			epoch.orgId !== liveEpoch.orgId ||
			epoch.generation !== liveEpoch.generation ||
			epoch.quoteId !== liveEpoch.quoteId
		);
	}

	function resetOrgScopedState() {
		quote = null;
		lines = [];
		clientOptions = [];
		products = [];
		viewState = { kind: 'loading' };
	}

	function mapLines(document: ApiQuoteDocument): LineItemRow[] {
		return document.lines.map((line) => ({
			id: line.id,
			productSku: line.sku_snapshot ?? undefined,
			productId: line.product_id,
			description: line.description,
			qty: String(line.quantity),
			unitPrice: centsToAmountString(line.unit_price_cents) || '0',
			total: centsToAmountString(line.total_cents) || '0',
			discountPercent: line.discount_percent,
			taxRatePercent: line.tax_rate_percent
		}));
	}

	function applyDocument(document: ApiQuoteDocument) {
		quote = document;
		quoteForm.form.set(toQuoteFormData(document));
		lines = mapLines(document);
	}

	async function loadAll() {
		if (!session.selectedOrgId) {
			onMissingOrg?.();
			viewState = {
				kind: 'forbidden',
				message: 'Select an organisation before opening quotes.'
			};
			return;
		}

		const epoch = captureEpoch();
		viewState = { kind: 'loading' };
		try {
			if (session.memberships.length === 0) {
				const membershipRows = await api.organisations.list();
				if (isStale(epoch)) return;
				session.setMemberships(membershipRows.map(toOrgMembershipSummary));
			}

			const [result, clients, catalog, rates] = await Promise.all([
				api.quotes.get(quoteId),
				api.clients.list({ limit: 100 }),
				api.products.list({ limit: 100, status: 'active' }),
				api.taxRates.list({ limit: 100 })
			]);
			if (isStale(epoch)) return;

			taxRates = rates;
			applyDocument(result.data);
			clientOptions = clients.data.map((c) => ({ id: c.id, name: c.name }));
			products = catalog.data.map((p) => toCatalogProductOption(p, taxRates));
			lineForm.form.set(emptyLineForm());
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			quote = null;
			if (isApiClientError(error) && (error.status === 404 || error.code === 'NOT_FOUND')) {
				viewState = { kind: 'not_found', message: 'Quote not found.' };
				return;
			}
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load quote.')
			};
		}
	}

	async function onSaveQuote(): Promise<boolean> {
		if (!quote || !canEditLines) return false;
		const epoch = captureEpoch();
		try {
			const updated = await api.quotes.update(
				quote.id,
				{
					...toQuoteUpdateBody(get(quoteForm.form)),
					lines: lineItemRowsToQuoteLineInputs(lines)
				},
				quote.version
			);
			if (isStale(epoch)) return false;
			applyDocument(updated);
			viewState = { kind: 'ready' };
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Quote changed elsewhere — reload and try again.')
				};
				return false;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not save quote — try again.'),
				fields: isApiClientError(error) ? error.fields : undefined
			};
			return false;
		}
	}

	async function onAddLine(): Promise<boolean> {
		if (!quote || !canEditLines) return false;
		const epoch = captureEpoch();
		const draftLine = get(lineForm.form);
		const nextInputs = [
			...lineItemRowsToQuoteLineInputs(lines),
			toQuoteLineInput(draftLine, lines.length)
		];
		try {
			const updated = await api.quotes.update(
				quote.id,
				{
					...toQuoteUpdateBody(get(quoteForm.form)),
					lines: nextInputs
				},
				quote.version
			);
			if (isStale(epoch)) return false;
			applyDocument(updated);
			lineForm.form.set(emptyLineForm());
			lineDrawerOpen = false;
			viewState = { kind: 'ready' };
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Quote changed elsewhere — reload and try again.')
				};
				return false;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not add line — try again.'),
				fields: isApiClientError(error) ? error.fields : undefined
			};
			return false;
		}
	}

	async function onRemoveLine(id: string) {
		if (!quote || !canEditLines) return;
		const epoch = captureEpoch();
		const next = lines.filter((line) => line.id !== id);
		try {
			const updated = await api.quotes.update(
				quote.id,
				{
					...toQuoteUpdateBody(get(quoteForm.form)),
					lines: lineItemRowsToQuoteLineInputs(next)
				},
				quote.version
			);
			if (isStale(epoch)) return;
			applyDocument(updated);
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Quote changed elsewhere — reload and try again.')
				};
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not remove line — try again.')
			};
		}
	}

	async function onAccept() {
		if (!quote || !canAccept) return;
		const epoch = captureEpoch();
		actionPending = true;
		try {
			const updated = await api.quotes.accept(quote.id, quote.version);
			if (isStale(epoch)) return;
			applyDocument(updated);
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Quote changed elsewhere — reload and try again.')
				};
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not accept quote — try again.')
			};
		} finally {
			actionPending = false;
		}
	}

	async function onConvert() {
		if (!quote || !canConvert) return;
		const epoch = captureEpoch();
		actionPending = true;
		try {
			const invoice = await api.invoices.createFromQuote({ quote_id: quote.id });
			if (isStale(epoch)) return;
			onConverted?.(invoice.id);
		} catch (error) {
			if (isStale(epoch)) return;
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not convert quote — try again.')
			};
		} finally {
			actionPending = false;
		}
	}

	function onSwitchOrg(orgId: string) {
		switchError = null;
		busy = true;
		resetOrgScopedState();
		session.selectOrg(orgId);
		onSwitchNavigate?.(orgId);
		busy = false;
	}

	async function onValidCreate(data: OrganisationCreateData): Promise<boolean> {
		createError = null;
		try {
			const result = await api.organisations.create(toOrganisationCreateBody(data));
			const membership = membershipFromCreateResult(result);
			session.setMemberships([...session.memberships, membership]);
			resetOrgScopedState();
			session.selectOrg(membership.org_id);
			onSwitchNavigate?.(membership.org_id);
			return true;
		} catch (error) {
			createError = userMessage(error, 'Could not create organisation — try again.');
			return false;
		}
	}

	$effect(() => {
		void session.selectedOrgId;
		void session.cacheGeneration;
		void quoteId;
		void loadAll();
	});
</script>

{#if currentOrgId}
	<div class={className} data-testid="quote-page">
		<AppShell
			{currentOrgId}
			memberships={session.memberships}
			{orgName}
			{navGroups}
			{switchError}
			{busy}
			{createError}
			{onSwitchOrg}
			{onLogout}
			{onValidCreate}
		>
			<div class="flex min-h-0 flex-1 flex-col">
				{#if viewState.kind !== 'ready'}
					<div class="px-6 pt-6 md:px-8">
						<ResourceStateBanner state={viewState} onReload={loadAll} />
					</div>
				{:else if quote}
					<QuoteDetailPage
						{orgName}
						{navGroups}
						title="{quote.number} · {quote.title}"
						status={quoteStatusLabel(quote.status)}
						{quoteForm}
						{lineForm}
						{products}
						{clientOptions}
						{canAccept}
						{canConvert}
						{canEditLines}
						{actionPending}
						moneyTotals={{
							subtotalCents: quote.subtotal_cents,
							discountCents: quote.discount_cents,
							taxCents: quote.tax_cents,
							totalCents: quote.total_cents
						}}
						bind:lines
						bind:lineDrawerOpen
						onSaveQuote={onSaveQuote}
						onAddLine={onAddLine}
						onRemoveLine={onRemoveLine}
						onAccept={onAccept}
						onConvert={onConvert}
						showNav={false}
						class="min-h-0 flex-1"
					/>
				{/if}
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="quote-page">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before opening quotes.
		</p>
	</div>
{/if}

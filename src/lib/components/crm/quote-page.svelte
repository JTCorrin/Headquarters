<script lang="ts">
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		membershipFromCreateResult,
		quoteStatusLabel,
		toOrganisationCreateBody,
		toOrgMembershipSummary,
		toQuoteFormData,
		toQuoteUpdateBody
	} from '$lib/api/v1/mappers.js';
	import type { ApiQuoteDocument } from '$lib/api/v1/types.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import { lineItemFormSchema } from '$lib/schemas/line-item.js';
	import type { OrganisationCreateData } from '$lib/schemas/organisation.js';
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
		onLogout?: () => void | Promise<void>;
		class?: string;
	}

	let {
		api,
		session,
		quoteId,
		onMissingOrg,
		onSwitchNavigate,
		onLogout,
		class: className
	}: QuotePageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let quote = $state<ApiQuoteDocument | null>(null);
	let clientOptions = $state<QuoteClientOption[]>([]);
	let lines = $state<LineItemRow[]>([]);
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);
	let lineDrawerOpen = $state(false);

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

	const lineForm = superForm(
		defaults({ productId: '', description: '', qty: '1', unitPrice: '0' }, zod4(lineItemFormSchema)),
		{
			validators: zod4(lineItemFormSchema),
			SPA: true,
			warnings: { duplicateId: false },
			applyAction: false,
			resetForm: false
		}
	);

	const orgName = $derived(
		session.memberships.find((m) => m.org_id === session.selectedOrgId)?.org_name ??
			'Organisation'
	);
	const navGroups = $derived(appNavGroups('Quotes'));
	const currentOrgId = $derived(session.selectedOrgId ?? '');

	function userMessage(error: unknown, fallback: string): string {
		if (isApiClientError(error)) {
			if (error.isNetworkError) return 'Network error — check your connection and retry.';
			if (error.isForbidden) return error.message || 'You do not have permission for this action.';
			if (error.status === 404 || error.code === 'NOT_FOUND') return 'Quote not found.';
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
		viewState = { kind: 'loading' };
	}

	function mapLines(document: ApiQuoteDocument): LineItemRow[] {
		return document.lines.map((line) => ({
			id: line.id,
			description: line.description,
			qty: String(line.quantity),
			unitPrice: (line.unit_price_cents / 100).toFixed(2),
			total: (line.total_cents / 100).toFixed(2)
		}));
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

			const [result, clients] = await Promise.all([
				api.quotes.get(quoteId),
				api.clients.list({ limit: 100 })
			]);
			if (isStale(epoch)) return;

			quote = result.data;
			clientOptions = clients.data.map((c) => ({ id: c.id, name: c.name }));
			quoteForm.form.set(toQuoteFormData(result.data));
			lines = mapLines(result.data);
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
		if (!quote) return false;
		const epoch = captureEpoch();
		try {
			const updated = await api.quotes.update(
				quote.id,
				toQuoteUpdateBody(get(quoteForm.form)),
				quote.version
			);
			if (isStale(epoch)) return false;
			quote = updated;
			quoteForm.form.set(toQuoteFormData(updated));
			lines = mapLines(updated);
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
						{clientOptions}
						bind:lines
						bind:lineDrawerOpen
						onSaveQuote={onSaveQuote}
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

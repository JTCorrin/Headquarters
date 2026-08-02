<script lang="ts">
	import { fromStore, get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		invoiceStatusLabel,
		lineItemRowsToInvoiceLineInputs,
		membershipFromCreateResult,
		toInvoiceFormData,
		toInvoiceLineInput,
		toInvoiceUpdateBody,
		toOrganisationCreateBody,
		toOrgMembershipSummary
	} from '$lib/api/v1/mappers.js';
	import type { ApiInvoiceDocument } from '$lib/api/v1/types.js';
	import { centsToAmountString } from '$lib/money.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import { lineItemFormSchema } from '$lib/schemas/line-item.js';
	import type { OrganisationCreateData } from '$lib/schemas/organisation.js';
	import {
		invoiceFormSchema,
		type InvoiceClientOption,
		type InvoiceContactOption,
		type InvoiceFormData
	} from '$lib/schemas/invoice.js';
	import type { LineItemRow } from './line-items-table.svelte';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import InvoiceDetailPage from './invoice-detail-page.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	export interface InvoicePageProps {
		api: ApiV1Client;
		session: OrgSession;
		invoiceId: string;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onDeleted?: () => void;
		onLogout?: () => void | Promise<void>;
		class?: string;
	}

	let {
		api,
		session,
		invoiceId,
		onMissingOrg,
		onSwitchNavigate,
		onDeleted,
		onLogout,
		class: className
	}: InvoicePageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let invoice = $state<ApiInvoiceDocument | null>(null);
	let clientOptions = $state<InvoiceClientOption[]>([]);
	let contactOptions = $state<InvoiceContactOption[]>([]);
	let lines = $state<LineItemRow[]>([]);
	let savedFingerprint = $state('');
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);
	let actionPending = $state(false);
	let lineDrawerOpen = $state(false);

	const invoiceForm = superForm(
		defaults(
			{
				clientId: '00000000-0000-4000-8000-000000000000',
				clientName: '',
				contactId: '',
				currency: 'GBP' as const,
				issueOn: '',
				dueOn: '',
				purchaseOrderNumber: '',
				status: 'draft' as const,
				quoteId: ''
			},
			zod4(invoiceFormSchema)
		),
		{
			validators: zod4(invoiceFormSchema),
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

	const formSnapshot = fromStore(invoiceForm.form);

	const orgName = $derived(
		session.memberships.find((m) => m.org_id === session.selectedOrgId)?.org_name ??
			'Organisation'
	);
	const navGroups = $derived(appNavGroups('Invoices'));
	const currentOrgId = $derived(session.selectedOrgId ?? '');
	const isDraft = $derived(invoice?.status === 'draft');

	function fingerprintFrom(form: InvoiceFormData, rowLines: LineItemRow[]) {
		return JSON.stringify({
			clientId: form.clientId,
			contactId: form.contactId,
			currency: form.currency,
			issueOn: form.issueOn,
			dueOn: form.dueOn,
			purchaseOrderNumber: form.purchaseOrderNumber,
			lines: rowLines.map((line) => ({
				id: line.id,
				productId: line.productId ?? null,
				description: line.description,
				qty: line.qty,
				unitPrice: line.unitPrice,
				discountPercent: line.discountPercent,
				taxRatePercent: line.taxRatePercent
			}))
		});
	}

	const isDirty = $derived.by(() => {
		if (!invoice || invoice.status !== 'draft' || !savedFingerprint) return false;
		return fingerprintFrom(formSnapshot.current, lines) !== savedFingerprint;
	});

	function userMessage(error: unknown, fallback: string): string {
		if (isApiClientError(error)) {
			if (error.isNetworkError) return 'Network error — check your connection and retry.';
			if (error.isForbidden) return error.message || 'You do not have permission for this action.';
			if (error.status === 404 || error.code === 'NOT_FOUND') return 'Invoice not found.';
			if (error.isPreconditionFailed) {
				return error.message || 'Invoice changed elsewhere — reload and try again.';
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
		invoiceId: string;
	}

	const liveEpoch: RequestEpoch = {
		orgId: null,
		generation: -1,
		invoiceId: ''
	};

	$effect(() => {
		liveEpoch.orgId = session.selectedOrgId;
		liveEpoch.generation = session.cacheGeneration;
		liveEpoch.invoiceId = invoiceId;
	});

	function captureEpoch(): RequestEpoch {
		return {
			orgId: liveEpoch.orgId,
			generation: liveEpoch.generation,
			invoiceId: liveEpoch.invoiceId
		};
	}

	function isStale(epoch: RequestEpoch): boolean {
		return (
			epoch.orgId !== liveEpoch.orgId ||
			epoch.generation !== liveEpoch.generation ||
			epoch.invoiceId !== liveEpoch.invoiceId
		);
	}

	function resetOrgScopedState() {
		invoice = null;
		lines = [];
		clientOptions = [];
		contactOptions = [];
		savedFingerprint = '';
		viewState = { kind: 'loading' };
	}

	function mapLines(document: ApiInvoiceDocument): LineItemRow[] {
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

	function applyDocument(document: ApiInvoiceDocument) {
		invoice = document;
		const formData = toInvoiceFormData(document);
		invoiceForm.form.set(formData);
		const mapped = mapLines(document);
		lines = mapped;
		savedFingerprint = fingerprintFrom(formData, mapped);
	}

	async function loadAll() {
		if (!session.selectedOrgId) {
			onMissingOrg?.();
			viewState = {
				kind: 'forbidden',
				message: 'Select an organisation before opening invoices.'
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

			const [result, clients, contacts] = await Promise.all([
				api.invoices.get(invoiceId),
				api.clients.list({ limit: 100 }),
				api.contacts.list({ limit: 100 })
			]);
			if (isStale(epoch)) return;

			applyDocument(result.data);
			clientOptions = clients.data.map((c) => ({ id: c.id, name: c.name }));
			const options: InvoiceContactOption[] = contacts.data.map((c) => ({
				id: c.id,
				label: c.display_name || c.primary_email || c.id,
				clientId: c.client_id ?? null
			}));
			const selectedContactId = result.data.contact_id;
			if (selectedContactId && !options.some((c) => c.id === selectedContactId)) {
				try {
					const pinned = await api.contacts.get(selectedContactId);
					if (isStale(epoch)) return;
					options.push({
						id: pinned.data.id,
						label:
							pinned.data.display_name || pinned.data.primary_email || pinned.data.id,
						clientId: pinned.data.client_id ?? null
					});
				} catch {
					// Keep the form contactId; never clear solely because the option page truncated.
				}
			}
			contactOptions = options;
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			invoice = null;
			if (isApiClientError(error) && (error.status === 404 || error.code === 'NOT_FOUND')) {
				viewState = { kind: 'not_found', message: 'Invoice not found.' };
				return;
			}
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load invoice.')
			};
		}
	}

	async function onSaveInvoice(): Promise<boolean> {
		if (!invoice || invoice.status !== 'draft') return false;
		const epoch = captureEpoch();
		try {
			const updated = await api.invoices.update(
				invoice.id,
				{
					...toInvoiceUpdateBody(get(invoiceForm.form)),
					lines: lineItemRowsToInvoiceLineInputs(lines)
				},
				invoice.version
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
					message: userMessage(error, 'Invoice changed elsewhere — reload and try again.')
				};
				return false;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not save invoice — try again.'),
				fields: isApiClientError(error) ? error.fields : undefined
			};
			return false;
		}
	}

	async function onAddLine(): Promise<boolean> {
		if (!invoice || invoice.status !== 'draft') return false;
		const epoch = captureEpoch();
		const draftLine = get(lineForm.form);
		const nextInputs = [
			...lineItemRowsToInvoiceLineInputs(lines),
			toInvoiceLineInput(draftLine, lines.length)
		];
		try {
			// Atomic with current header so applyDocument cannot discard unsaved PO/date/client.
			const updated = await api.invoices.update(
				invoice.id,
				{
					...toInvoiceUpdateBody(get(invoiceForm.form)),
					lines: nextInputs
				},
				invoice.version
			);
			if (isStale(epoch)) return false;
			applyDocument(updated);
			lineForm.form.set({ productId: '', description: '', qty: '1', unitPrice: '0' });
			lineDrawerOpen = false;
			viewState = { kind: 'ready' };
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Invoice changed elsewhere — reload and try again.')
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
		if (!invoice || invoice.status !== 'draft') return;
		const epoch = captureEpoch();
		const next = lines.filter((line) => line.id !== id);
		try {
			const updated = await api.invoices.update(
				invoice.id,
				{
					...toInvoiceUpdateBody(get(invoiceForm.form)),
					lines: lineItemRowsToInvoiceLineInputs(next)
				},
				invoice.version
			);
			if (isStale(epoch)) return;
			applyDocument(updated);
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Invoice changed elsewhere — reload and try again.')
				};
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not remove line — try again.')
			};
		}
	}

	async function runLifecycle(
		action: () => Promise<ApiInvoiceDocument>,
		fallback: string
	): Promise<void> {
		if (!invoice) return;
		const epoch = captureEpoch();
		actionPending = true;
		try {
			const updated = await action();
			if (isStale(epoch)) return;
			applyDocument(updated);
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Invoice changed elsewhere — reload and try again.')
				};
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, fallback)
			};
		} finally {
			actionPending = false;
		}
	}

	async function onSend() {
		if (!invoice || invoice.status !== 'draft') return;
		if (isDirty) {
			viewState = {
				kind: 'validation',
				message: 'Save your changes before sending this invoice.'
			};
			return;
		}
		const version = invoice.version;
		await runLifecycle(
			() => api.invoices.send(invoice!.id, version),
			'Could not send invoice — try again.'
		);
	}

	async function onVoid() {
		if (!invoice) return;
		const reason = window.prompt('Void reason (required):')?.trim();
		if (!reason) return;
		const version = invoice.version;
		await runLifecycle(
			() => api.invoices.void(invoice!.id, { void_reason: reason }, version),
			'Could not void invoice — try again.'
		);
	}

	async function onDelete() {
		if (!invoice || invoice.status !== 'draft') return;
		const epoch = captureEpoch();
		actionPending = true;
		try {
			await api.invoices.delete(invoice.id, invoice.version);
			if (isStale(epoch)) return;
			onDeleted?.();
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Invoice changed elsewhere — reload and try again.')
				};
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not delete draft — try again.')
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
		void invoiceId;
		void loadAll();
	});
</script>

{#if currentOrgId}
	<div class={className} data-testid="invoice-page">
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
				{:else if invoice}
					<InvoiceDetailPage
						{orgName}
						{navGroups}
						title={invoice.number}
						status={invoiceStatusLabel(invoice.status)}
						{invoiceForm}
						{lineForm}
						{clientOptions}
						{contactOptions}
						{isDraft}
						{isDirty}
						{actionPending}
						moneyTotals={{
							subtotalCents: invoice.subtotal_cents,
							discountCents: invoice.discount_cents,
							taxCents: invoice.tax_cents,
							totalCents: invoice.total_cents
						}}
						bind:lines
						bind:lineDrawerOpen
						onSaveInvoice={onSaveInvoice}
						onAddLine={onAddLine}
						onRemoveLine={onRemoveLine}
						onSend={onSend}
						onVoid={onVoid}
						onDelete={onDelete}
						showNav={false}
						class="min-h-0 flex-1"
					/>
				{/if}
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="invoice-page">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before opening invoices.
		</p>
	</div>
{/if}

<script lang="ts">
	import { fromStore, get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		roleFromMemberships,
		invoiceStatusLabel,
		lineItemRowsToInvoiceLineInputs,
		membershipFromCreateResult,
		toCatalogProductOption,
		toInvoiceFormData,
		toInvoiceLineInput,
		toInvoiceUpdateBody,
		toOrganisationCreateBody,
		toOrgMembershipSummary,
		toPaymentCreateBody,
		toPaymentListItem
	} from '$lib/api/v1/mappers.js';
	import type { ApiInvoiceDocument, ApiTaxRate } from '$lib/api/v1/types.js';
	import { centsToAmountString } from '$lib/money.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import {
		defaultTaxRatePercentString,
		lineItemFormSchema,
		type CatalogProductOption
	} from '$lib/schemas/line-item.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import {
		invoiceFormSchema,
		type InvoiceClientOption,
		type InvoiceContactOption,
		type InvoiceFormData
	} from '$lib/schemas/invoice.js';
	import {
		paymentFormSchema,
		type PaymentListItem
	} from '$lib/schemas/payment.js';
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
	let products = $state<CatalogProductOption[]>([]);
	let taxRates = $state<ApiTaxRate[]>([]);
	let lines = $state<LineItemRow[]>([]);
	let paymentRows = $state<PaymentListItem[]>([]);
	let savedFingerprint = $state('');
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);
	let actionPending = $state(false);
	let lineDrawerOpen = $state(false);
	let paymentDrawerOpen = $state(false);

	function emptyLineForm() {
		return {
			productId: '',
			description: '',
			qty: '1',
			unitPrice: '0',
			taxRatePercent: defaultTaxRatePercentString(taxRates)
		};
	}

	function todayIso(): string {
		return new Date().toISOString().slice(0, 10);
	}

	function formatCents(cents: number, currency: string): string {
		try {
			return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(cents / 100);
		} catch {
			return `${(cents / 100).toFixed(2)} ${currency}`;
		}
	}

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

	const lineForm = superForm(defaults(emptyLineForm(), zod4(lineItemFormSchema)), {
		validators: zod4(lineItemFormSchema),
		SPA: true,
		warnings: { duplicateId: false },
		applyAction: false,
		resetForm: false
	});

	const paymentForm = superForm(
		defaults(
			{
				direction: 'inbound' as const,
				clientId: '',
				clientName: '',
				vendorId: '',
				vendorName: '',
				invoiceId: '',
				billId: '',
				amount: '',
				currency: 'GBP' as const,
				method: 'bank' as const,
				occurredOn: todayIso(),
				reference: '',
				notes: ''
			},
			zod4(paymentFormSchema)
		),
		{
			validators: zod4(paymentFormSchema),
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
	const role = $derived(
		(roleFromMemberships(session.memberships, session.selectedOrgId) ??
			'member') as MembershipRole
	);
	const navGroups = $derived(appNavGroups('Invoices', role));
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
		paymentRows = [];
		clientOptions = [];
		contactOptions = [];
		products = [];
		savedFingerprint = '';
		paymentDrawerOpen = false;
		viewState = { kind: 'loading' };
	}

	function syncPaymentForm(document: ApiInvoiceDocument) {
		const clientName = clientOptions.find((c) => c.id === document.client_id)?.name ?? '';
		paymentForm.form.set({
			direction: 'inbound',
			clientId: document.client_id,
			clientName,
			vendorId: '',
			vendorName: '',
			invoiceId: document.id,
			billId: '',
			amount:
				document.balance_due_cents > 0
					? centsToAmountString(document.balance_due_cents) || ''
					: '',
			currency:
				document.currency === 'USD' || document.currency === 'EUR' || document.currency === 'GBP'
					? document.currency
					: 'GBP',
			method: 'bank',
			occurredOn: todayIso(),
			reference: '',
			notes: ''
		});
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

			const [result, clients, contacts, catalog, rates] = await Promise.all([
				api.invoices.get(invoiceId),
				api.clients.list({ limit: 100 }),
				api.contacts.list({ limit: 100 }),
				api.products.list({ limit: 100, status: 'active' }),
				api.taxRates.list({ limit: 100 })
			]);
			if (isStale(epoch)) return;

			taxRates = rates;
			applyDocument(result.data);
			clientOptions = clients.data.map((c) => ({ id: c.id, name: c.name }));
			products = catalog.data.map((p) => toCatalogProductOption(p, taxRates));
			lineForm.form.set(emptyLineForm());

			const listedPayments = await api.payments.list({
				limit: 50,
				invoice_id: invoiceId
			});
			if (isStale(epoch)) return;
			paymentRows = listedPayments.data.map((payment) =>
				toPaymentListItem(payment, {
					clientName: clients.data.find((c) => c.id === payment.client_id)?.name
				})
			);
			syncPaymentForm(result.data);
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
				// Rejected pin fetch still awaits; bail if org/invoice switched meanwhile.
				if (isStale(epoch)) return;
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
			lineForm.form.set(emptyLineForm());
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

	async function onRecordPayment(): Promise<boolean> {
		if (!invoice) return false;
		const epoch = captureEpoch();
		actionPending = true;
		try {
			const created = await api.payments.create(toPaymentCreateBody(get(paymentForm.form)));
			if (isStale(epoch)) return false;
			paymentRows = [
				toPaymentListItem(created, {
					clientName: clientOptions.find((c) => c.id === created.client_id)?.name
				}),
				...paymentRows
			];
			const refreshed = await api.invoices.get(invoice.id);
			if (isStale(epoch)) return false;
			applyDocument(refreshed.data);
			syncPaymentForm(refreshed.data);
			paymentDrawerOpen = false;
			viewState = { kind: 'ready' };
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Payment changed elsewhere — reload and try again.')
				};
				return false;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not record payment — try again.'),
				fields: isApiClientError(error) ? error.fields : undefined
			};
			return false;
		} finally {
			actionPending = false;
		}
	}

	async function onReversePayment(paymentId: string) {
		const epoch = captureEpoch();
		const row = paymentRows.find((r) => r.id === paymentId);
		if (!row || !invoice) return;
		const reason = window.prompt('Reason for reversing this payment?', 'Correction');
		if (!reason?.trim()) return;
		actionPending = true;
		try {
			const reversed = await api.payments.reverse(
				paymentId,
				{ reason: reason.trim() },
				row.version
			);
			if (isStale(epoch)) return;
			paymentRows = paymentRows.map((r) =>
				r.id === paymentId
					? toPaymentListItem(reversed, {
							clientName: clientOptions.find((c) => c.id === reversed.client_id)?.name
						})
					: r
			);
			const refreshed = await api.invoices.get(invoice.id);
			if (isStale(epoch)) return;
			applyDocument(refreshed.data);
			syncPaymentForm(refreshed.data);
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not reverse payment — try again.')
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
						{products}
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
						{paymentForm}
						{paymentRows}
						paymentClientOptions={clientOptions}
						paymentInvoiceOptions={[
							{
								id: invoice.id,
								number: invoice.number,
								clientId: invoice.client_id,
								currency: invoice.currency,
								balanceDueCents: invoice.balance_due_cents,
								status: invoice.status
							}
						]}
						bind:paymentDrawerOpen
						paidLabel={formatCents(invoice.paid_cents, invoice.currency)}
						balanceLabel={formatCents(invoice.balance_due_cents, invoice.currency)}
						canRecordPayment={['sent', 'partial', 'paid'].includes(invoice.status)}
						bind:lines
						bind:lineDrawerOpen
						onSaveInvoice={onSaveInvoice}
						onAddLine={onAddLine}
						onRemoveLine={onRemoveLine}
						onSend={onSend}
						onVoid={onVoid}
						onDelete={onDelete}
						onRecordPayment={onRecordPayment}
						onReversePayment={onReversePayment}
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

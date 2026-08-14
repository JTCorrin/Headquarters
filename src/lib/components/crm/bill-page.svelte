<script lang="ts">
	import { fromStore, get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		roleFromMemberships,
		billStatusLabel,
		lineItemRowsToBillLineInputs,
		membershipFromCreateResult,
		toBillFormData,
		toBillLineInput,
		toBillUpdateBody,
		toCatalogProductOption,
		toOrganisationBrandingResource,
		toOrganisationCreateBody,
		toOrgMembershipSummary,
		toPaymentCreateBody,
		toPaymentListItem,
		toVendorCreateBody
	} from '$lib/api/v1/mappers.js';
	import type { ApiBillDocument, ApiTaxRate } from '$lib/api/v1/types.js';
	import {
		createEntityTimelineEvent,
		loadEntityTimeline
	} from '$lib/crm/entity-timeline.js';
	import {
		isBillSourceAttachmentFile,
		loadBillSourceAttachmentMeta,
		uploadBillSourceDocument,
		type BillSourceAttachmentMeta
	} from '$lib/crm/bill-source-attachment.js';
	import type { DocumentPreviewState } from '$lib/api/v1/document-workspace-controller.svelte.js';
	import { isInlineDocumentPreview } from '$lib/api/v1/document-workspace-controller.svelte.js';
	import { centsToAmountString } from '$lib/money.js';
	import { formatOrgLetterheadLines, loadOrgLogoDataUrl } from '$lib/org/branding.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import {
		lineItemFormSchema,
		type CatalogProductOption
	} from '$lib/schemas/line-item.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import {
		billFormSchema,
		type BillFormData,
		type BillVendorOption
	} from '$lib/schemas/bill.js';
	import {
		paymentFormSchema,
		type PaymentListItem
	} from '$lib/schemas/payment.js';
	import { vendorFormSchema } from '$lib/schemas/vendor.js';
	import type { LineItemRow } from './line-items-table.svelte';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import type { TimelineComposerSubmit } from './timeline-composer.svelte';
	import type { TimelineEvent } from './timeline.svelte';
	import AppShell from './app-shell.svelte';
	import BillDetailPage from './bill-detail-page.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	export interface BillPageProps {
		api: ApiV1Client;
		session: OrgSession;
		billId: string;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onDeleted?: () => void;
		onLogout?: () => void | Promise<void>;
		class?: string;
	}

	let {
		api,
		session,
		billId,
		onMissingOrg,
		onSwitchNavigate,
		onDeleted,
		onLogout,
		class: className
	}: BillPageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let bill = $state<ApiBillDocument | null>(null);
	let vendorOptions = $state<BillVendorOption[]>([]);
	let products = $state<CatalogProductOption[]>([]);
	let taxRates = $state<ApiTaxRate[]>([]);
	let lines = $state<LineItemRow[]>([]);
	let timelineEvents = $state<TimelineEvent[]>([]);
	let paymentRows = $state<PaymentListItem[]>([]);
	let savedFingerprint = $state('');
	let orgLogoDataUrl = $state<string | undefined>(undefined);
	let orgAddressLines = $state<string[]>([]);
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);
	let actionPending = $state(false);
	let lineDrawerOpen = $state(false);
	let vendorDrawerOpen = $state(false);
	let paymentDrawerOpen = $state(false);
	let sourceAttachment = $state<BillSourceAttachmentMeta | null>(null);
	let sourceAttachmentPending = $state(false);
	let sourceAttachmentError = $state<string | null>(null);
	let sourcePreview = $state<DocumentPreviewState | null>(null);

	function formatCents(cents: number, currency: string): string {
		try {
			return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(cents / 100);
		} catch {
			return `${(cents / 100).toFixed(2)} ${currency}`;
		}
	}

	const billForm = superForm(
		defaults(
			{
				vendorId: '00000000-0000-4000-8000-000000000000',
				vendorName: '',
				number: '',
				internalReference: '',
				currency: 'GBP' as const,
				issueOn: '',
				receivedOn: '',
				dueOn: '',
				notes: '',
				status: 'draft' as const
			},
			zod4(billFormSchema)
		),
		{
			validators: zod4(billFormSchema),
			SPA: true,
			warnings: { duplicateId: false },
			applyAction: false,
			resetForm: false
		}
	);

	const vendorForm = superForm(
		defaults({ name: '' }, zod4(vendorFormSchema)),
		{
			validators: zod4(vendorFormSchema),
			SPA: true,
			warnings: { duplicateId: false },
			applyAction: false,
			resetForm: false
		}
	);

	const lineForm = superForm(
		defaults(
			{ productId: '', description: '', qty: '1', unitPrice: '0', discountPercent: '0' },
			zod4(lineItemFormSchema)
		),
		{
			validators: zod4(lineItemFormSchema),
			SPA: true,
			warnings: { duplicateId: false },
			applyAction: false,
			resetForm: false
		}
	);

	function todayIso(): string {
		return new Date().toISOString().slice(0, 10);
	}

	const paymentForm = superForm(
		defaults(
			{
				direction: 'outbound' as const,
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

	const formSnapshot = fromStore(billForm.form);

	const orgName = $derived(
		session.memberships.find((m) => m.org_id === session.selectedOrgId)?.org_name ??
			'Organisation'
	);
	const role = $derived(
		(roleFromMemberships(session.memberships, session.selectedOrgId) ??
			'member') as MembershipRole
	);
	const navGroups = $derived(appNavGroups('Bills', role));
	const currentOrgId = $derived(session.selectedOrgId ?? '');
	const isDraft = $derived(bill?.status === 'draft');

	function fingerprintFrom(form: BillFormData, rowLines: LineItemRow[]) {
		return JSON.stringify({
			vendorId: form.vendorId,
			number: form.number,
			internalReference: form.internalReference,
			currency: form.currency,
			issueOn: form.issueOn,
			receivedOn: form.receivedOn,
			dueOn: form.dueOn,
			notes: form.notes,
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
		if (!bill || bill.status !== 'draft' || !savedFingerprint) return false;
		return fingerprintFrom(formSnapshot.current, lines) !== savedFingerprint;
	});

	function userMessage(error: unknown, fallback: string): string {
		if (isApiClientError(error)) {
			if (error.isNetworkError) return 'Network error — check your connection and retry.';
			if (error.isForbidden) return error.message || 'You do not have permission for this action.';
			if (error.status === 404 || error.code === 'NOT_FOUND') return 'Bill not found.';
			if (error.isPreconditionFailed) {
				return error.message || 'Bill changed elsewhere — reload and try again.';
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
		billId: string;
	}

	const liveEpoch: RequestEpoch = {
		orgId: null,
		generation: -1,
		billId: ''
	};

	$effect(() => {
		liveEpoch.orgId = session.selectedOrgId;
		liveEpoch.generation = session.cacheGeneration;
		liveEpoch.billId = billId;
	});

	function captureEpoch(): RequestEpoch {
		return {
			orgId: liveEpoch.orgId,
			generation: liveEpoch.generation,
			billId: liveEpoch.billId
		};
	}

	function isStale(epoch: RequestEpoch): boolean {
		return (
			epoch.orgId !== liveEpoch.orgId ||
			epoch.generation !== liveEpoch.generation ||
			epoch.billId !== liveEpoch.billId
		);
	}

	function resetOrgScopedState() {
		bill = null;
		lines = [];
		timelineEvents = [];
		paymentRows = [];
		vendorOptions = [];
		products = [];
		taxRates = [];
		savedFingerprint = '';
		orgLogoDataUrl = undefined;
		orgAddressLines = [];
		paymentDrawerOpen = false;
		sourceAttachment = null;
		sourceAttachmentPending = false;
		sourceAttachmentError = null;
		sourcePreview = null;
		viewState = { kind: 'loading' };
	}

	async function refreshSourceAttachment(
		document: ApiBillDocument,
		epoch: RequestEpoch
	): Promise<void> {
		const meta = await loadBillSourceAttachmentMeta(
			api,
			document.id,
			document.attachment_document_id
		);
		if (isStale(epoch)) return;
		sourceAttachment = meta;
	}

	function syncPaymentForm(document: ApiBillDocument) {
		const vendorName = vendorOptions.find((v) => v.id === document.vendor_id)?.name ?? '';
		paymentForm.form.set({
			direction: 'outbound',
			clientId: '',
			clientName: '',
			vendorId: document.vendor_id,
			vendorName,
			invoiceId: '',
			billId: document.id,
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

	function mapLines(document: ApiBillDocument): LineItemRow[] {
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

	function applyDocument(document: ApiBillDocument) {
		bill = document;
		const formData = toBillFormData(document);
		billForm.form.set(formData);
		const mapped = mapLines(document);
		lines = mapped;
		savedFingerprint = fingerprintFrom(formData, mapped);
	}

	async function loadAll() {
		if (!session.selectedOrgId) {
			onMissingOrg?.();
			viewState = {
				kind: 'forbidden',
				message: 'Select an organisation before opening bills.'
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

			const [result, vendors, catalog, rates, branding] = await Promise.all([
				api.bills.get(billId),
				api.vendors.list({ limit: 100 }),
				api.products.list({ limit: 100, status: 'active' }),
				api.taxRates.list({ limit: 100 }),
				api.organisationConfig.getBranding()
			]);
			if (isStale(epoch)) return;

			taxRates = rates;
			applyDocument(result.data);
			const brandingResource = toOrganisationBrandingResource(branding);
			orgAddressLines = formatOrgLetterheadLines(brandingResource);
			orgLogoDataUrl = await loadOrgLogoDataUrl(brandingResource.logo_url);
			if (isStale(epoch)) return;
			vendorOptions = vendors.data.map((v) => ({
				id: v.id,
				name: v.name,
				defaultCurrency: v.default_currency
			}));
			products = catalog.data.map((p) => toCatalogProductOption(p, taxRates));

			const listedPayments = await api.payments.list({
				limit: 50,
				bill_id: billId
			});
			if (isStale(epoch)) return;
			paymentRows = listedPayments.data.map((payment) =>
				toPaymentListItem(payment, {
					vendorName: vendors.data.find((v) => v.id === payment.vendor_id)?.name
				})
			);

			const selectedVendorId = result.data.vendor_id;
			if (selectedVendorId && !vendorOptions.some((v) => v.id === selectedVendorId)) {
				try {
					const pinned = await api.vendors.get(selectedVendorId);
					if (isStale(epoch)) return;
					vendorOptions.push({
						id: pinned.data.id,
						name: pinned.data.name,
						defaultCurrency: pinned.data.default_currency
					});
				} catch {
					// Keep form vendorId; never clear solely because the option page truncated.
				}
				if (isStale(epoch)) return;
			}

			syncPaymentForm(result.data);
			viewState = { kind: 'ready' };
			await refreshSourceAttachment(result.data, epoch);
			if (isStale(epoch)) return;

			const timeline = await loadEntityTimeline(api, 'bill', billId);
			if (isStale(epoch)) return;
			timelineEvents = timeline;
		} catch (error) {
			if (isStale(epoch)) return;
			bill = null;
			timelineEvents = [];
			if (isApiClientError(error) && (error.status === 404 || error.code === 'NOT_FOUND')) {
				viewState = { kind: 'not_found', message: 'Bill not found.' };
				return;
			}
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load bill.')
			};
		}
	}

	async function onSaveBill(): Promise<boolean> {
		if (!bill || bill.status !== 'draft') return false;
		const epoch = captureEpoch();
		try {
			const updated = await api.bills.update(
				bill.id,
				{
					...toBillUpdateBody(get(billForm.form)),
					lines: lineItemRowsToBillLineInputs(lines)
				},
				bill.version
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
					message: userMessage(error, 'Bill changed elsewhere — reload and try again.')
				};
				return false;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not save bill — try again.'),
				fields: isApiClientError(error) ? error.fields : undefined
			};
			return false;
		}
	}

	async function onAddLine(): Promise<boolean> {
		if (!bill || bill.status !== 'draft') return false;
		const epoch = captureEpoch();
		const draftLine = get(lineForm.form);
		const nextInputs = [
			...lineItemRowsToBillLineInputs(lines),
			toBillLineInput(draftLine, lines.length)
		];
		try {
			const updated = await api.bills.update(
				bill.id,
				{
					...toBillUpdateBody(get(billForm.form)),
					lines: nextInputs
				},
				bill.version
			);
			if (isStale(epoch)) return false;
			applyDocument(updated);
			lineForm.form.set({
				productId: '',
				description: '',
				qty: '1',
				unitPrice: '0',
				discountPercent: '0'
			});
			lineDrawerOpen = false;
			viewState = { kind: 'ready' };
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Bill changed elsewhere — reload and try again.')
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
		if (!bill || bill.status !== 'draft') return;
		const epoch = captureEpoch();
		const next = lines.filter((line) => line.id !== id);
		try {
			const updated = await api.bills.update(
				bill.id,
				{
					...toBillUpdateBody(get(billForm.form)),
					lines: lineItemRowsToBillLineInputs(next)
				},
				bill.version
			);
			if (isStale(epoch)) return;
			applyDocument(updated);
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Bill changed elsewhere — reload and try again.')
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
		action: () => Promise<ApiBillDocument>,
		fallback: string
	): Promise<void> {
		if (!bill) return;
		const epoch = captureEpoch();
		actionPending = true;
		try {
			const updated = await action();
			if (isStale(epoch)) return;
			applyDocument(updated);
			timelineEvents = await loadEntityTimeline(api, 'bill', billId);
			if (isStale(epoch)) return;
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Bill changed elsewhere — reload and try again.')
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

	async function onTimelineAdd(submit: TimelineComposerSubmit) {
		const created = await createEntityTimelineEvent(api, 'bill', billId, submit);
		timelineEvents = [created, ...timelineEvents.filter((event) => event.id !== created.id)];
	}

	async function onReceive() {
		if (!bill || bill.status !== 'draft') return;
		if (isDirty) {
			viewState = {
				kind: 'validation',
				message: 'Save your changes before receiving this bill.'
			};
			return;
		}
		const version = bill.version;
		await runLifecycle(
			() => api.bills.receive(bill!.id, version),
			'Could not receive bill — try again.'
		);
	}

	async function onVoid() {
		if (!bill) return;
		const reason = window.prompt('Void reason (required):')?.trim();
		if (!reason) return;
		const version = bill.version;
		await runLifecycle(
			() => api.bills.void(bill!.id, { void_reason: reason }, version),
			'Could not void bill — try again.'
		);
	}

	async function onDelete() {
		if (!bill || bill.status !== 'draft') return;
		const epoch = captureEpoch();
		actionPending = true;
		try {
			await api.bills.delete(bill.id, bill.version);
			if (isStale(epoch)) return;
			onDeleted?.();
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Bill changed elsewhere — reload and try again.')
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

	async function onCreateVendor(): Promise<boolean> {
		const epoch = captureEpoch();
		const data = get(vendorForm.form);
		try {
			const created = await api.vendors.create(toVendorCreateBody(data));
			if (isStale(epoch)) return false;
			vendorOptions = [
				...vendorOptions,
				{ id: created.id, name: created.name, defaultCurrency: created.default_currency }
			];
			billForm.form.update((current) => ({
				...current,
				vendorId: created.id,
				vendorName: created.name
			}));
			vendorForm.form.set({ name: '' });
			vendorDrawerOpen = false;
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not create vendor — try again.'),
				fields: isApiClientError(error) ? error.fields : undefined
			};
			return false;
		}
	}

	async function onRecordPayment(): Promise<boolean> {
		if (!bill) return false;
		const epoch = captureEpoch();
		actionPending = true;
		try {
			const created = await api.payments.create(toPaymentCreateBody(get(paymentForm.form)));
			if (isStale(epoch)) return false;
			paymentRows = [
				toPaymentListItem(created, {
					vendorName: vendorOptions.find((v) => v.id === created.vendor_id)?.name
				}),
				...paymentRows
			];
			const refreshed = await api.bills.get(bill.id);
			if (isStale(epoch)) return false;
			applyDocument(refreshed.data);
			syncPaymentForm(refreshed.data);
			paymentDrawerOpen = false;
			viewState = { kind: 'ready' };
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
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
		if (!row || !bill) return;
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
							vendorName: vendorOptions.find((v) => v.id === reversed.vendor_id)?.name
						})
					: r
			);
			const refreshed = await api.bills.get(bill.id);
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

	async function onSourceUpload(file: File): Promise<void> {
		if (!bill || bill.status !== 'draft') return;
		if (!isBillSourceAttachmentFile(file)) {
			sourceAttachmentError = 'Source attachment must be a PDF or image.';
			return;
		}
		const epoch = captureEpoch();
		const previous = sourceAttachment;
		sourceAttachmentPending = true;
		sourceAttachmentError = null;
		try {
			const uploaded = await uploadBillSourceDocument(api, bill.id, file);
			if (isStale(epoch)) return;
			const updated = await api.bills.update(
				bill.id,
				{ attachment_document_id: uploaded.id },
				bill.version
			);
			if (isStale(epoch)) return;
			applyDocument(updated);
			sourceAttachment = {
				id: uploaded.id,
				name: uploaded.name,
				mimeType: uploaded.mime_type,
				version: uploaded.version,
				sizeBytes: uploaded.size_bytes
			};
			if (previous && previous.id !== uploaded.id) {
				try {
					await api.documents.delete(previous.id, previous.version);
				} catch {
					// Link already moved; orphan cleanup is best-effort.
				}
			}
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Bill changed elsewhere — reload and try again.')
				};
				return;
			}
			sourceAttachmentError = userMessage(error, 'Could not upload source document.');
		} finally {
			if (!isStale(epoch)) sourceAttachmentPending = false;
		}
	}

	async function onSourceClear(): Promise<void> {
		if (!bill || bill.status !== 'draft' || !bill.attachment_document_id) return;
		const epoch = captureEpoch();
		const previous = sourceAttachment;
		sourceAttachmentPending = true;
		sourceAttachmentError = null;
		try {
			const updated = await api.bills.update(
				bill.id,
				{ attachment_document_id: null },
				bill.version
			);
			if (isStale(epoch)) return;
			applyDocument(updated);
			sourceAttachment = null;
			sourcePreview = null;
			if (previous) {
				try {
					await api.documents.delete(previous.id, previous.version);
				} catch {
					// Clearing the FK is the product requirement; delete is best-effort.
				}
			}
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isPreconditionFailed) {
				viewState = {
					kind: 'conflict',
					message: userMessage(error, 'Bill changed elsewhere — reload and try again.')
				};
				return;
			}
			sourceAttachmentError = userMessage(error, 'Could not clear source document.');
		} finally {
			if (!isStale(epoch)) sourceAttachmentPending = false;
		}
	}

	async function onSourcePreview(): Promise<void> {
		if (!sourceAttachment) return;
		sourceAttachmentError = null;
		try {
			// inline=1 so storage does not force Content-Disposition: attachment
			// (attachment signed URLs download-loop PDFs in the preview iframe).
			const result = await api.documents.download(sourceAttachment.id, { inline: true });
			if (!isInlineDocumentPreview(result.mime_type)) {
				if (typeof document !== 'undefined') {
					const anchor = document.createElement('a');
					anchor.href = result.signed_url;
					anchor.download = result.name;
					anchor.rel = 'noopener';
					anchor.target = '_blank';
					anchor.click();
				}
				return;
			}
			sourcePreview = {
				documentId: result.document_id,
				url: result.signed_url,
				name: result.name,
				mimeType: result.mime_type
			};
		} catch (error) {
			sourceAttachmentError = userMessage(error, 'Could not open source preview.');
		}
	}

	function onCloseSourcePreview() {
		sourcePreview = null;
	}

	async function onDownloadSourcePreview(): Promise<void> {
		if (!sourceAttachment) return;
		try {
			const result = await api.documents.download(sourceAttachment.id);
			if (typeof document !== 'undefined') {
				const anchor = document.createElement('a');
				anchor.href = result.signed_url;
				anchor.download = result.name;
				anchor.rel = 'noopener';
				anchor.click();
			}
		} catch (error) {
			sourceAttachmentError = userMessage(error, 'Could not download source document.');
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
		void billId;
		void loadAll();
	});
</script>

{#if currentOrgId}
	<div class={className} data-testid="bill-page">
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
				{:else if bill}
					<BillDetailPage
						{orgName}
						{orgLogoDataUrl}
						{orgAddressLines}
						{navGroups}
						title={bill.number}
						status={billStatusLabel(bill.status)}
						{billForm}
						vendorForm={vendorForm}
						{lineForm}
						{products}
						{vendorOptions}
						{isDraft}
						{isDirty}
						{actionPending}
						moneyTotals={{
							subtotalCents: bill.subtotal_cents,
							discountCents: bill.discount_cents,
							taxCents: bill.tax_cents,
							totalCents: bill.total_cents
						}}
						{paymentForm}
						{paymentRows}
						paymentVendorOptions={vendorOptions}
						paymentBillOptions={[
							{
								id: bill.id,
								number: bill.number,
								vendorId: bill.vendor_id,
								currency: bill.currency,
								balanceDueCents: bill.balance_due_cents,
								status: bill.status
							}
						]}
						bind:paymentDrawerOpen
						paidLabel={formatCents(bill.paid_cents, bill.currency)}
						balanceLabel={formatCents(bill.balance_due_cents, bill.currency)}
						canRecordPayment={['received', 'partial', 'paid'].includes(bill.status)}
						bind:lines
						bind:timelineEvents
						bind:lineDrawerOpen
						bind:vendorDrawerOpen
						onSaveBill={onSaveBill}
						onAddLine={onAddLine}
						onRemoveLine={onRemoveLine}
						onReceive={onReceive}
						onVoid={onVoid}
						onDelete={onDelete}
						onValidVendorCreate={onCreateVendor}
						onRecordPayment={onRecordPayment}
						onReversePayment={onReversePayment}
						{onTimelineAdd}
						{sourceAttachment}
						{sourceAttachmentPending}
						{sourceAttachmentError}
						{sourcePreview}
						{onSourceUpload}
						{onSourceClear}
						{onSourcePreview}
						{onCloseSourcePreview}
						{onDownloadSourcePreview}
						showNav={false}
						class="min-h-0 flex-1"
					/>
				{/if}
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="bill-page">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before opening bills.
		</p>
	</div>
{/if}

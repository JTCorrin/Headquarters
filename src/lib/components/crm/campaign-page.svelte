<script lang="ts">
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError, userMessage as sharedUserMessage } from '$lib/api/v1/errors.js';
	import {
		membershipFromCreateResult,
		roleFromMemberships,
		toOrganisationCreateBody,
		toOrgMembershipSummary
	} from '$lib/api/v1/mappers.js';
	import type {
		ApiCampaign,
		ApiCampaignAudiencePreview,
		ApiCampaignRecipient,
		ApiEmailTemplate,
		ApiOrgMailbox,
		ApiTag
	} from '$lib/api/v1/types.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import { campaignFormSchema, type CampaignFormData } from '$lib/schemas/campaign.js';
	import {
		canMutateCrmRecords,
		type MembershipRole,
		type OrganisationCreateData
	} from '$lib/schemas/organisation.js';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import CampaignDetailPage from './campaign-detail-page.svelte';
	import CampaignEditorPage from './campaign-editor-page.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	export interface CampaignPageProps {
		api: ApiV1Client;
		session: OrgSession;
		/** Pass `new` for create; otherwise a campaign UUID. */
		campaignId: string;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onLogout?: () => void | Promise<void>;
		onSaved?: (id: string) => void;
		onDeleted?: () => void;
		onBack?: () => void;
		class?: string;
	}

	let {
		api,
		session,
		campaignId,
		onMissingOrg,
		onSwitchNavigate,
		onLogout,
		onSaved,
		onDeleted,
		onBack,
		class: className
	}: CampaignPageProps = $props();

	const isNew = $derived(campaignId === 'new');

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let campaign = $state<ApiCampaign | null>(null);
	let recipients = $state<ApiCampaignRecipient[]>([]);
	let templates = $state<ApiEmailTemplate[]>([]);
	let mailboxes = $state<ApiOrgMailbox[]>([]);
	let orgTags = $state<ApiTag[]>([]);
	let preview = $state<ApiCampaignAudiencePreview | null>(null);
	let previewLoading = $state(false);
	let version = $state(0);
	let title = $state('New campaign');
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);

	const emptyCampaignForm = (): CampaignFormData => ({
		name: '',
		template_id: '',
		mailbox_id: '',
		tag_ids: [],
		entity_types: ['lead', 'contact', 'client'],
		scheduled_at: ''
	});

	const campaignForm = superForm(defaults(emptyCampaignForm(), zod4(campaignFormSchema)), {
		validators: zod4(campaignFormSchema),
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
	const navGroups = $derived(appNavGroups('Campaigns', role));
	const currentOrgId = $derived(session.selectedOrgId ?? '');
	const canEdit = $derived(canMutateCrmRecords(role));
	const isDraft = $derived(isNew || campaign?.status === 'draft');

	function userMessage(error: unknown, fallback: string): string {
		return sharedUserMessage(error, fallback, {
			conflictMessage: 'This campaign changed elsewhere — reload and try again.'
		});
	}

	function toFormData(data: ApiCampaign): CampaignFormData {
		return {
			name: data.name,
			template_id: data.template_id ?? '',
			mailbox_id: data.mailbox_id ?? '',
			tag_ids: data.tag_ids,
			entity_types: data.entity_types,
			scheduled_at: data.scheduled_at ?? ''
		};
	}

	function toCreateBody(form: CampaignFormData) {
		return {
			name: form.name.trim(),
			template_id: form.template_id || null,
			mailbox_id: form.mailbox_id || null,
			scheduled_at: form.scheduled_at || null,
			tag_ids: form.tag_ids,
			entity_types: form.entity_types
		};
	}

	interface RequestEpoch {
		orgId: string | null;
		generation: number;
		campaignId: string;
	}

	const liveEpoch: RequestEpoch = {
		orgId: null,
		generation: -1,
		campaignId: ''
	};

	$effect(() => {
		liveEpoch.orgId = session.selectedOrgId;
		liveEpoch.generation = session.cacheGeneration;
		liveEpoch.campaignId = campaignId;
	});

	function captureEpoch(): RequestEpoch {
		return {
			orgId: liveEpoch.orgId,
			generation: liveEpoch.generation,
			campaignId: liveEpoch.campaignId
		};
	}

	function isStale(epoch: RequestEpoch): boolean {
		return (
			epoch.orgId !== liveEpoch.orgId ||
			epoch.generation !== liveEpoch.generation ||
			epoch.campaignId !== liveEpoch.campaignId
		);
	}

	function resetOrgScopedState() {
		campaign = null;
		recipients = [];
		preview = null;
		version = 0;
		title = isNew ? 'New campaign' : 'Campaign';
		campaignForm.form.set(emptyCampaignForm());
		viewState = { kind: 'loading' };
	}

	async function loadReferenceData(epoch: RequestEpoch) {
		const [templateResult, mailboxResult, tagResult] = await Promise.all([
			api.emailTemplates.list({ limit: 100, status: 'active' }),
			api.orgMailboxes.list(),
			api.tags.list({ limit: 200 })
		]);
		if (isStale(epoch)) return;
		templates = templateResult.data;
		mailboxes = mailboxResult.data.filter((m) => m.status === 'active');
		orgTags = tagResult.data;
	}

	async function loadRecipients(id: string, epoch: RequestEpoch) {
		const result = await api.campaigns.listRecipients(id, { limit: 500 });
		if (isStale(epoch)) return;
		recipients = result.data;
	}

	async function loadAll() {
		if (!session.selectedOrgId) {
			onMissingOrg?.();
			viewState = {
				kind: 'forbidden',
				message: 'Select an organisation before opening campaigns.'
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

			await loadReferenceData(epoch);
			if (isStale(epoch)) return;

			if (isNew) {
				campaign = null;
				version = 0;
				title = 'New campaign';
				campaignForm.form.set(emptyCampaignForm());
				viewState = { kind: 'ready' };
				return;
			}

			const result = await api.campaigns.get(campaignId);
			if (isStale(epoch)) return;
			campaign = result.data;
			version = result.data.version;
			title = result.data.name;
			campaignForm.form.set(toFormData(result.data));

			if (result.data.status !== 'draft') {
				await loadRecipients(campaignId, epoch);
			}

			if (isStale(epoch)) return;
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.status === 404) {
				viewState = { kind: 'not_found', message: 'Campaign not found.' };
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load campaign.')
			};
		}
	}

	async function persistDraft(): Promise<ApiCampaign | null> {
		const form = get(campaignForm.form);
		const epoch = captureEpoch();
		busy = true;
		try {
			if (isNew || !campaign) {
				const created = await api.campaigns.create(toCreateBody(form));
				if (isStale(epoch)) return null;
				campaign = created;
				version = created.version;
				title = created.name;
				onSaved?.(created.id);
				return created;
			}

			const updated = await api.campaigns.update(campaign.id, toCreateBody(form), version);
			if (isStale(epoch)) return null;
			campaign = updated;
			version = updated.version;
			title = updated.name;
			return updated;
		} catch (error) {
			if (!isStale(epoch)) {
				if (isApiClientError(error) && error.isPreconditionFailed) {
					viewState = {
						kind: 'conflict',
						message: userMessage(error, 'Could not save campaign.')
					};
				} else {
					viewState = {
						kind: 'validation',
						message: userMessage(error, 'Could not save campaign.'),
						fields: isApiClientError(error) ? error.fields : undefined
					};
				}
			}
			return null;
		} finally {
			if (!isStale(epoch)) busy = false;
		}
	}

	async function validateCampaignForm(): Promise<boolean> {
		const result = await campaignForm.validateForm({ update: true });
		return result.valid;
	}

	function launchReadyMessage(form: CampaignFormData): boolean {
		const fields: Record<string, string> = {};
		if (!form.template_id) fields.template_id = 'Select a template';
		if (!form.mailbox_id) fields.mailbox_id = 'Select a mailbox';
		if (form.tag_ids.length === 0) fields.tag_ids = 'Select at least one audience tag';
		if (Object.keys(fields).length === 0) return true;

		if (fields.template_id || fields.mailbox_id) {
			campaignForm.errors.update((current) => {
				const next = { ...current };
				if (fields.template_id) next.template_id = [fields.template_id];
				if (fields.mailbox_id) next.mailbox_id = [fields.mailbox_id];
				return next;
			});
		}
		viewState = {
			kind: 'validation',
			message: 'Finish the draft before launching or scheduling.',
			fields
		};
		return false;
	}

	async function onSave() {
		if (!(await validateCampaignForm())) return;
		const saved = await persistDraft();
		if (saved) viewState = { kind: 'ready' };
	}

	async function onPreview() {
		if (!(await validateCampaignForm())) return;
		const form = get(campaignForm.form);
		if (form.tag_ids.length === 0) {
			viewState = {
				kind: 'validation',
				message: 'Select at least one audience tag to preview.',
				fields: { tag_ids: 'Select at least one audience tag' }
			};
			return;
		}
		const saved = await persistDraft();
		if (!saved) return;

		previewLoading = true;
		try {
			preview = await api.campaigns.audiencePreview(saved.id, {
				tag_ids: form.tag_ids,
				entity_types: form.entity_types
			});
			viewState = { kind: 'ready' };
		} catch (error) {
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not preview audience.')
			};
		} finally {
			previewLoading = false;
		}
	}

	async function onLaunch(sendImmediately = true) {
		if (!(await validateCampaignForm())) return;
		const form = get(campaignForm.form);
		if (!launchReadyMessage(form)) return;
		const saved = await persistDraft();
		if (!saved) return;

		busy = true;
		const epoch = captureEpoch();
		try {
			const launched = await api.campaigns.launch(saved.id, saved.version, {
				sendImmediately
			});
			if (isStale(epoch)) return;
			campaign = launched;
			version = launched.version;
			viewState = { kind: 'ready' };
			if (launched.status !== 'draft') {
				try {
					await loadRecipients(launched.id, epoch);
				} catch (recipientsError) {
					if (!isStale(epoch)) {
						viewState = {
							kind: 'validation',
							message: userMessage(
								recipientsError,
								'Campaign launched, but recipients could not be loaded. Reload to refresh.'
							)
						};
					}
				}
			}
		} catch (error) {
			if (!isStale(epoch)) {
				if (isApiClientError(error) && error.isPreconditionFailed) {
					viewState = {
						kind: 'conflict',
						message: userMessage(error, 'Could not launch campaign.')
					};
				} else {
					viewState = {
						kind: 'validation',
						message: userMessage(error, 'Could not launch campaign.')
					};
				}
			}
		} finally {
			if (!isStale(epoch)) busy = false;
		}
	}

	async function onSchedule() {
		await onLaunch(false);
	}

	async function onDelete() {
		if (!campaign) return;
		busy = true;
		const epoch = captureEpoch();
		try {
			await api.campaigns.delete(campaign.id, version);
			if (isStale(epoch)) return;
			onDeleted?.();
		} catch (error) {
			if (!isStale(epoch)) {
				viewState = {
					kind: 'validation',
					message: userMessage(error, 'Could not delete campaign.')
				};
			}
		} finally {
			if (!isStale(epoch)) busy = false;
		}
	}

	async function onCancelCampaign() {
		if (!campaign) return;
		busy = true;
		const epoch = captureEpoch();
		try {
			const cancelled = await api.campaigns.cancel(campaign.id, version);
			if (isStale(epoch)) return;
			campaign = cancelled;
			version = cancelled.version;
			await loadRecipients(cancelled.id, epoch);
			viewState = { kind: 'ready' };
		} catch (error) {
			if (!isStale(epoch)) {
				viewState = {
					kind: 'validation',
					message: userMessage(error, 'Could not cancel campaign.')
				};
			}
		} finally {
			if (!isStale(epoch)) busy = false;
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
		void campaignId;
		void loadAll();
	});
</script>

{#if currentOrgId}
	<div class={className} data-testid="campaign-page">
		<AppShell
			{orgName}
			{navGroups}
			{currentOrgId}
			memberships={session.memberships}
			{switchError}
			{createError}
			{busy}
			{onSwitchOrg}
			onValidCreate={onValidCreate}
			{onLogout}
		>
			{#if viewState.kind === 'not_found'}
				<div class="px-6 pt-6 md:px-8">
					<ResourceStateBanner state={viewState} onReload={loadAll} />
				</div>
			{:else if isDraft}
				<CampaignEditorPage
					{orgName}
					{navGroups}
					{title}
					status="Draft"
					form={campaignForm}
					{templates}
					{mailboxes}
					{orgTags}
					{preview}
					{previewLoading}
					{busy}
					{viewState}
					onReload={loadAll}
					onSave={canEdit ? onSave : undefined}
					onPreview={canEdit ? onPreview : undefined}
					onLaunch={canEdit ? () => onLaunch(true) : undefined}
					onSchedule={canEdit ? onSchedule : undefined}
					{onBack}
					onDelete={canEdit && campaign ? onDelete : undefined}
					showNav={false}
					class="min-h-0 flex-1"
				/>
			{:else if campaign}
				<CampaignDetailPage
					{orgName}
					{navGroups}
					{campaign}
					{recipients}
					{viewState}
					{busy}
					onReload={loadAll}
					{onBack}
					onCancel={canEdit ? onCancelCampaign : undefined}
					showNav={false}
					class="min-h-0 flex-1"
				/>
			{:else}
				<div class="px-6 pt-6 md:px-8">
					<ResourceStateBanner state={viewState} onReload={loadAll} />
				</div>
			{/if}
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="campaign-page">
		<p class="text-sm text-destructive" role="alert">
			Select an organisation before opening campaigns.
		</p>
	</div>
{/if}

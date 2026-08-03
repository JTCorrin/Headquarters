<script lang="ts">
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		membershipFromCreateResult,
		roleFromMemberships,
		toEmailTemplateCreateBody,
		toEmailTemplateFormData,
		toEmailTemplateUpdateBody,
		toOrganisationCreateBody,
		toOrgMembershipSummary
	} from '$lib/api/v1/mappers.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import {
		emailTemplateFormSchema,
		type EmailTemplateFormData
	} from '$lib/schemas/email-template.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import AppShell from './app-shell.svelte';
	import EmailTemplateEditorPage from './email-template-editor-page.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';

	export interface EmailTemplatePageProps {
		api: ApiV1Client;
		session: OrgSession;
		/** Pass `new` for create; otherwise a template UUID. */
		templateId: string;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onLogout?: () => void | Promise<void>;
		onSaved?: (id: string) => void;
		onBack?: () => void;
		class?: string;
	}

	let {
		api,
		session,
		templateId,
		onMissingOrg,
		onSwitchNavigate,
		onLogout,
		onSaved,
		onBack,
		class: className
	}: EmailTemplatePageProps = $props();

	const isNew = $derived(templateId === 'new');

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let version = $state(0);
	let title = $state('New template');
	let statusLabel = $state('Draft');
	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);

	const emptyTemplateForm = (): EmailTemplateFormData => ({
		name: '',
		subject: '',
		body: '',
		category: 'other',
		status: 'draft'
	});

	const templateForm = superForm(defaults(emptyTemplateForm(), zod4(emailTemplateFormSchema)), {
		validators: zod4(emailTemplateFormSchema),
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
	const navGroups = $derived(appNavGroups('Templates', role));
	const currentOrgId = $derived(session.selectedOrgId ?? '');

	function userMessage(error: unknown, fallback: string): string {
		if (isApiClientError(error)) {
			if (error.isNetworkError) return 'Network error — check your connection and retry.';
			if (error.isForbidden) return error.message || 'You do not have permission for this action.';
			if (error.isPreconditionFailed) {
				return 'This template changed elsewhere — reload and try again.';
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
		templateId: string;
	}

	const liveEpoch: RequestEpoch = {
		orgId: null,
		generation: -1,
		templateId: ''
	};

	$effect(() => {
		liveEpoch.orgId = session.selectedOrgId;
		liveEpoch.generation = session.cacheGeneration;
		liveEpoch.templateId = templateId;
	});

	function captureEpoch(): RequestEpoch {
		return {
			orgId: liveEpoch.orgId,
			generation: liveEpoch.generation,
			templateId: liveEpoch.templateId
		};
	}

	function isStale(epoch: RequestEpoch): boolean {
		return (
			epoch.orgId !== liveEpoch.orgId ||
			epoch.generation !== liveEpoch.generation ||
			epoch.templateId !== liveEpoch.templateId
		);
	}

	function resetOrgScopedState() {
		version = 0;
		title = isNew ? 'New template' : 'Email template';
		statusLabel = 'Draft';
		templateForm.form.set(emptyTemplateForm());
		viewState = { kind: 'loading' };
	}

	async function loadAll() {
		if (!session.selectedOrgId) {
			onMissingOrg?.();
			viewState = {
				kind: 'forbidden',
				message: 'Select an organisation before opening email templates.'
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

			if (isNew) {
				templateForm.form.set(emptyTemplateForm());
				title = 'New template';
				statusLabel = 'Draft';
				version = 0;
				viewState = { kind: 'ready' };
				return;
			}

			const result = await api.emailTemplates.get(templateId);
			if (isStale(epoch)) return;
			const template = result.data;
			templateForm.form.set(toEmailTemplateFormData(template));
			title = template.name;
			statusLabel = template.status.charAt(0).toUpperCase() + template.status.slice(1);
			version = template.version;
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isStale(epoch)) return;
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			if (isApiClientError(error) && error.status === 404) {
				viewState = { kind: 'forbidden', message: 'Template not found.' };
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load template.')
			};
		}
	}

	async function onSaveTemplate(): Promise<boolean> {
		const epoch = captureEpoch();
		const form = get(templateForm.form);
		try {
			if (isNew) {
				const created = await api.emailTemplates.create(toEmailTemplateCreateBody(form));
				if (isStale(epoch)) return false;
				version = created.version;
				title = created.name;
				statusLabel = created.status.charAt(0).toUpperCase() + created.status.slice(1);
				viewState = { kind: 'ready' };
				onSaved?.(created.id);
				return true;
			}

			const updated = await api.emailTemplates.update(
				templateId,
				toEmailTemplateUpdateBody(form),
				version
			);
			if (isStale(epoch)) return false;
			version = updated.version;
			title = updated.name;
			statusLabel = updated.status.charAt(0).toUpperCase() + updated.status.slice(1);
			viewState = { kind: 'ready' };
			onSaved?.(updated.id);
			return true;
		} catch (error) {
			if (isStale(epoch)) return false;
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not save template — try again.'),
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
		void templateId;
		void loadAll();
	});
</script>

{#if currentOrgId}
	<div class={className} data-testid="email-template-page">
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
				{#if viewState.kind !== 'ready' && viewState.kind !== 'validation'}
					<div class="px-6 pt-6 md:px-8">
						<ResourceStateBanner state={viewState} onReload={loadAll} />
					</div>
				{:else}
					<EmailTemplateEditorPage
						{orgName}
						{navGroups}
						{title}
						status={statusLabel}
						form={templateForm}
						{viewState}
						onReload={loadAll}
						onValidSubmit={onSaveTemplate}
						{onBack}
						showNav={false}
						class="min-h-0 flex-1"
					/>
				{/if}
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="email-template-page">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before opening email templates.
		</p>
	</div>
{/if}

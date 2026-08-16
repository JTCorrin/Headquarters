<script lang="ts">
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		membershipFromCreateResult,
		roleFromMemberships,
		toOrganisationCreateBody
	} from '$lib/api/v1/mappers.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import AppShell from './app-shell.svelte';
	import DocumentWorkspaceApiHost from './document-workspace-api-host.svelte';

	export interface DocumentsPageProps {
		api: ApiV1Client;
		session: OrgSession;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onLogout?: () => void | Promise<void>;
		class?: string;
	}

	let {
		api,
		session,
		onMissingOrg,
		onSwitchNavigate,
		onLogout,
		class: className
	}: DocumentsPageProps = $props();

	let switchError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let busy = $state(false);

	const orgName = $derived(
		session.memberships.find((m) => m.org_id === session.selectedOrgId)?.org_name ??
			'Organisation'
	);
	const role = $derived(
		(roleFromMemberships(session.memberships, session.selectedOrgId) ??
			'member') as MembershipRole
	);
	const navGroups = $derived(appNavGroups('Documents', role));
	const currentOrgId = $derived(session.selectedOrgId ?? '');

	function userMessage(error: unknown, fallback: string): string {
		if (isApiClientError(error)) {
			if (error.isNetworkError) return 'Network error — check your connection and retry.';
			if (error.isForbidden) return error.message || 'You do not have permission for this action.';
			if (error.isValidationError) {
				if (error.fields) return Object.values(error.fields).join(' · ') || error.message;
				return error.message;
			}
			return error.message || fallback;
		}
		return fallback;
	}

	function onSwitchOrg(orgId: string) {
		switchError = null;
		busy = true;
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
			session.selectOrg(membership.org_id);
			onSwitchNavigate?.(membership.org_id);
			return true;
		} catch (error) {
			createError = userMessage(error, 'Could not create organisation — try again.');
			return false;
		}
	}

	$effect(() => {
		if (!session.selectedOrgId) {
			onMissingOrg?.();
		}
	});
</script>

{#if currentOrgId}
	<div class={className} data-testid="documents-page">
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
			<div class="flex min-h-0 flex-1 flex-col px-4 py-6 sm:px-6 md:px-8">
				<DocumentWorkspaceApiHost
					client={api}
					entityType="organisation"
					entityId={currentOrgId}
					reloadKey={session.cacheGeneration}
					title="Documents"
					emptyMessage="No documents yet — upload files or create a folder for this organisation."
					class="min-h-0 flex-1"
				/>
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="documents-page">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before opening documents.
		</p>
	</div>
{/if}

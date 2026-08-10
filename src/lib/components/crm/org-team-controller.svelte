<script lang="ts">
	import { onMount } from 'svelte';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import { roleFromMemberships, toOrgMembershipSummary } from '$lib/api/v1/mappers.js';
	import type {
		ApiOrganisationAccessRole,
		ApiOrganisationInvitation,
		ApiOrganisationManagedMember,
		ApiOrganisationMemberPatch
	} from '$lib/api/v1/types.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import {
		isMailboxOutboundReady,
		MAILBOX_OUTBOUND_REQUIRED_MESSAGE
	} from '$lib/org/mailbox-outbound.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import { canManageOrganisationAccess, type MembershipRole } from '$lib/schemas/organisation.js';
	import AppShell from './app-shell.svelte';
	import OrgTeamPage from './org-team-page.svelte';
	import type { ResourceViewState } from './resource-state-banner.svelte';

	export interface OrgTeamControllerProps {
		api: ApiV1Client;
		session: OrgSession;
		onMissingOrg?: () => void;
		onLogout?: () => void | Promise<void>;
	}

	let { api, session, onMissingOrg, onLogout }: OrgTeamControllerProps = $props();

	let members = $state<ApiOrganisationManagedMember[]>([]);
	let invitations = $state<ApiOrganisationInvitation[]>([]);
	let outboundReady = $state<boolean | null>(null);
	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let actionError = $state<string | null>(null);

	const role = $derived(
		(roleFromMemberships(session.memberships, session.selectedOrgId) ?? 'member') as MembershipRole
	);
	const currentOrgId = $derived(session.selectedOrgId ?? '');
	const currentMembershipId = $derived(
		session.memberships.find((membership) => membership.org_id === session.selectedOrgId)
			?.membership_id ?? null
	);
	const orgName = $derived(
		session.memberships.find((membership) => membership.org_id === session.selectedOrgId)
			?.org_name ?? 'Organisation'
	);
	const navGroups = $derived(appNavGroups('Team', role));

	function message(error: unknown, fallback: string): string {
		if (!isApiClientError(error)) return fallback;
		if (error.isNetworkError) return 'Network error — check your connection and retry.';
		if (error.fields) return Object.values(error.fields).join(' · ') || error.message;
		return error.message || fallback;
	}

	function pending(rows: ApiOrganisationInvitation[]): ApiOrganisationInvitation[] {
		return rows.filter((invitation) => !invitation.accepted_at && !invitation.revoked_at);
	}

	async function loadAll(): Promise<void> {
		if (!session.selectedOrgId) {
			onMissingOrg?.();
			return;
		}
		const orgId = session.selectedOrgId;
		const generation = session.cacheGeneration;
		viewState = { kind: 'loading' };
		actionError = null;
		try {
			if (session.memberships.length === 0) {
				const organisationRows = await api.organisations.list();
				if (orgId !== session.selectedOrgId || generation !== session.cacheGeneration) return;
				session.setMemberships(organisationRows.map(toOrgMembershipSummary));
			}
			const currentRole = roleFromMemberships(session.memberships, session.selectedOrgId);
			if (!currentRole || !canManageOrganisationAccess(currentRole)) {
				viewState = {
					kind: 'forbidden',
					message: 'Team settings are available to Owners and Admins.'
				};
				return;
			}
			const [memberRows, invitationRows, mailbox] = await Promise.all([
				api.organisationAccess.listMembers(),
				api.organisationAccess.listInvitations(),
				api.mailbox.get().catch((error: unknown) => {
					if (
						isApiClientError(error) &&
						(error.status === 404 || error.code === 'NOT_FOUND')
					) {
						return null;
					}
					throw error;
				})
			]);
			if (orgId !== session.selectedOrgId || generation !== session.cacheGeneration) return;
			members = memberRows;
			invitations = pending(invitationRows);
			outboundReady = isMailboxOutboundReady(mailbox);
			viewState = { kind: 'ready' };
		} catch (error) {
			if (orgId !== session.selectedOrgId || generation !== session.cacheGeneration) return;
			viewState =
				isApiClientError(error) && error.isForbidden
					? { kind: 'forbidden', message: message(error, 'Team access is forbidden.') }
					: { kind: 'validation', message: message(error, 'Could not load team settings.') };
		}
	}

	async function invite(email: string, inviteRole: ApiOrganisationAccessRole): Promise<boolean> {
		actionError = null;
		if (outboundReady !== true) {
			actionError = MAILBOX_OUTBOUND_REQUIRED_MESSAGE;
			return false;
		}
		try {
			const created = await api.organisationAccess.invite({ email, role: inviteRole });
			invitations = [created, ...invitations.filter((row) => row.id !== created.id)];
			return true;
		} catch (error) {
			actionError = message(error, 'Could not send the invitation.');
			return false;
		}
	}

	async function revokeInvitation(invitation: ApiOrganisationInvitation): Promise<boolean> {
		actionError = null;
		try {
			await api.organisationAccess.revokeInvitation(invitation.id);
			invitations = invitations.filter((row) => row.id !== invitation.id);
			return true;
		} catch (error) {
			actionError = message(error, 'Could not revoke the invitation.');
			return false;
		}
	}

	async function resendInvitation(invitation: ApiOrganisationInvitation): Promise<boolean> {
		actionError = null;
		if (outboundReady !== true) {
			actionError = MAILBOX_OUTBOUND_REQUIRED_MESSAGE;
			return false;
		}
		try {
			await api.organisationAccess.revokeInvitation(invitation.id);
			const created = await api.organisationAccess.invite({
				email: invitation.email,
				role: invitation.role
			});
			invitations = [created, ...invitations.filter((row) => row.id !== invitation.id)];
			return true;
		} catch (error) {
			actionError = message(
				error,
				'Could not resend the invitation. The previous link may have been revoked.'
			);
			void loadAll();
			return false;
		}
	}

	async function updateMember(
		member: ApiOrganisationManagedMember,
		patch: ApiOrganisationMemberPatch
	): Promise<boolean> {
		actionError = null;
		try {
			const updated = await api.organisationAccess.updateMember(member.id, patch);
			members = members.map((row) => (row.id === updated.id ? updated : row));
			return true;
		} catch (error) {
			actionError = message(error, 'Could not update the member.');
			return false;
		}
	}

	async function removeMember(member: ApiOrganisationManagedMember): Promise<boolean> {
		actionError = null;
		try {
			await api.organisationAccess.removeMember(member.id);
			members = members.filter((row) => row.id !== member.id);
			return true;
		} catch (error) {
			actionError = message(error, 'Could not remove the member.');
			return false;
		}
	}

	async function transferOwnership(member: ApiOrganisationManagedMember): Promise<boolean> {
		actionError = null;
		try {
			const result = await api.organisationAccess.transferOwnership(member.id);
			members = members.map((row) => {
				if (row.id === result.owner_membership_id) return { ...row, role: 'owner' };
				if (row.id === result.previous_owner_membership_id) return { ...row, role: 'admin' };
				return row;
			});
			session.setMemberships(
				session.memberships.map((membership) =>
					membership.membership_id === result.previous_owner_membership_id
						? { ...membership, role: 'admin' }
						: membership
				)
			);
			return true;
		} catch (error) {
			actionError = message(error, 'Could not transfer ownership.');
			return false;
		}
	}

	function switchOrg(orgId: string): void {
		members = [];
		invitations = [];
		outboundReady = null;
		session.selectOrg(orgId);
		void loadAll();
	}

	onMount(() => {
		void loadAll();
	});
</script>

{#if currentOrgId}
	<AppShell
		{currentOrgId}
		memberships={session.memberships}
		{orgName}
		{navGroups}
		onSwitchOrg={switchOrg}
		{onLogout}
	>
		{#if canManageOrganisationAccess(role)}
			<OrgTeamPage
				{role}
				{currentMembershipId}
				{members}
				{invitations}
				{outboundReady}
				{viewState}
				{actionError}
				onReload={loadAll}
				onInvite={invite}
				onRevokeInvitation={revokeInvitation}
				onResendInvitation={resendInvitation}
				onUpdateMember={updateMember}
				onRemoveMember={removeMember}
				onTransferOwnership={transferOwnership}
			/>
		{:else}
			<div class="p-6">
				<p class="text-sm text-destructive" role="alert">
					Team settings are available to Owners and Admins.
				</p>
			</div>
		{/if}
	</AppShell>
{:else}
	<div class="p-6">
		<p class="text-sm text-muted-foreground">Select an organisation to manage its team.</p>
	</div>
{/if}

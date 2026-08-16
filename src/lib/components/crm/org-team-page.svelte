<script lang="ts">
	import type {
		ApiOrganisationAccessRole,
		ApiOrganisationInvitation,
		ApiOrganisationManagedMember
	} from '$lib/api/v1/types.js';
	import type { MembershipRole } from '$lib/schemas/organisation.js';
	import { roleLabel } from '$lib/schemas/organisation.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import type { ResourceViewState } from './resource-state-banner.svelte';
	import PageHeader from './page-header.svelte';
	import ResourceStateBanner from './resource-state-banner.svelte';
	import StatusBadge from './status-badge.svelte';
	import TeamInvitations from './team-invitations.svelte';

	export interface OrgTeamPageProps {
		role: MembershipRole;
		currentMembershipId?: string | null;
		members?: ApiOrganisationManagedMember[];
		invitations?: ApiOrganisationInvitation[];
		outboundReady?: boolean | null;
		viewState?: ResourceViewState;
		actionError?: string | null;
		onReload?: () => void;
		onInvite?: (
			email: string,
			role: ApiOrganisationAccessRole
		) => boolean | void | Promise<boolean | void>;
		onRevokeInvitation?: (
			invitation: ApiOrganisationInvitation
		) => boolean | void | Promise<boolean | void>;
		onResendInvitation?: (
			invitation: ApiOrganisationInvitation
		) => boolean | void | Promise<boolean | void>;
		onUpdateMember?: (
			member: ApiOrganisationManagedMember,
			patch: { role?: ApiOrganisationAccessRole; status?: 'active' | 'suspended' }
		) => boolean | void | Promise<boolean | void>;
		onRemoveMember?: (
			member: ApiOrganisationManagedMember
		) => boolean | void | Promise<boolean | void>;
		onTransferOwnership?: (
			member: ApiOrganisationManagedMember
		) => boolean | void | Promise<boolean | void>;
	}

	let {
		role,
		currentMembershipId = null,
		members = [],
		invitations = [],
		outboundReady = true,
		viewState = { kind: 'ready' },
		actionError = null,
		onReload,
		onInvite,
		onRevokeInvitation,
		onResendInvitation,
		onUpdateMember,
		onRemoveMember,
		onTransferOwnership
	}: OrgTeamPageProps = $props();

	let busyMember = $state<string | null>(null);
	const activeMembers = $derived(members.filter((member) => member.status === 'active'));
	const suspendedMembers = $derived(members.filter((member) => member.status === 'suspended'));
	const showContent = $derived(viewState.kind === 'ready' || viewState.kind === 'empty');

	function editableRoles(member: ApiOrganisationManagedMember): ApiOrganisationAccessRole[] {
		if (role === 'owner') return ['admin', 'member', 'billing', 'readonly'];
		if (member.role === 'admin' || member.role === 'owner') return [];
		return ['member', 'billing', 'readonly'];
	}

	function canEdit(member: ApiOrganisationManagedMember): boolean {
		if (member.id === currentMembershipId || member.role === 'owner') return false;
		if (role === 'owner') return true;
		return member.role !== 'admin';
	}

	async function updateRole(member: ApiOrganisationManagedMember, event: Event): Promise<void> {
		const select = event.currentTarget as HTMLSelectElement;
		const nextRole = select.value as ApiOrganisationAccessRole;
		if (nextRole === member.role) return;
		if (!window.confirm(`Change ${member.display_name}'s role to ${roleLabel(nextRole)}?`)) {
			select.value = member.role;
			return;
		}
		busyMember = member.id;
		try {
			const updated = await onUpdateMember?.(member, { role: nextRole });
			if (updated === false) select.value = member.role;
		} catch {
			select.value = member.role;
		} finally {
			busyMember = null;
		}
	}

	async function toggleStatus(member: ApiOrganisationManagedMember): Promise<void> {
		const nextStatus = member.status === 'active' ? 'suspended' : 'active';
		const verb = nextStatus === 'suspended' ? 'Suspend' : 'Reactivate';
		if (!window.confirm(`${verb} ${member.display_name}?`)) return;
		busyMember = member.id;
		try {
			await onUpdateMember?.(member, { status: nextStatus });
		} finally {
			busyMember = null;
		}
	}

	async function remove(member: ApiOrganisationManagedMember): Promise<void> {
		if (
			!window.confirm(
				`Remove ${member.display_name} from this organisation? Their access will end immediately.`
			)
		)
			return;
		busyMember = member.id;
		try {
			await onRemoveMember?.(member);
		} finally {
			busyMember = null;
		}
	}

	async function transfer(member: ApiOrganisationManagedMember): Promise<void> {
		if (
			!window.confirm(
				`Transfer ownership to ${member.display_name}? You will become an Admin and only the new Owner can reverse this.`
			)
		)
			return;
		busyMember = member.id;
		try {
			await onTransferOwnership?.(member);
		} finally {
			busyMember = null;
		}
	}
</script>

{#snippet memberList(rows: ApiOrganisationManagedMember[], status: 'active' | 'suspended')}
	{#if rows.length === 0}
		<p class="text-sm text-muted-foreground">No {status} members.</p>
	{:else}
		<ul class="divide-y divide-border rounded-3xl border">
			{#each rows as member (member.id)}
				<li
					class="flex flex-wrap items-center justify-between gap-4 px-4 py-3"
					data-testid={`team-member-${member.id}`}
				>
					<div class="min-w-0">
						<div class="flex flex-wrap items-center gap-2">
							<p class="truncate font-medium">{member.display_name}</p>
							<StatusBadge status={member.status} />
							{#if member.id === currentMembershipId}
								<span class="text-xs text-muted-foreground">You</span>
							{/if}
						</div>
						<p class="truncate text-sm text-muted-foreground">{member.email}</p>
					</div>
					<div class="flex flex-wrap items-center gap-2">
						{#if canEdit(member)}
							<select
								class="h-8 rounded-3xl bg-input/50 px-3 text-sm"
								value={member.role}
								disabled={busyMember === member.id}
								onchange={(event) => updateRole(member, event)}
								aria-label={`Role for ${member.display_name}`}
								data-testid={`team-member-role-${member.id}`}
							>
								{#each editableRoles(member) as option (option)}
									<option value={option}>{roleLabel(option)}</option>
								{/each}
							</select>
							<Button
								type="button"
								size="sm"
								variant="outline"
								disabled={busyMember === member.id}
								onclick={() => toggleStatus(member)}
							>
								{member.status === 'active' ? 'Suspend' : 'Reactivate'}
							</Button>
							<Button
								type="button"
								size="sm"
								variant="ghost"
								disabled={busyMember === member.id}
								onclick={() => remove(member)}
							>
								Remove
							</Button>
							{#if role === 'owner' && member.status === 'active'}
								<Button
									type="button"
									size="sm"
									variant="outline"
									disabled={busyMember === member.id}
									onclick={() => transfer(member)}
								>
									Transfer ownership
								</Button>
							{/if}
						{:else}
							<span class="text-sm text-muted-foreground">{roleLabel(member.role)}</span>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

<div class="space-y-8 px-4 py-6 sm:px-6 md:px-8" data-testid="org-team-page">
	<PageHeader
		breadcrumb="Organisation · Settings"
		title="Team"
		description="Manage member access, invitations, and organisation ownership."
	>
		{#snippet actions()}
			<span class="text-xs text-muted-foreground">Your role: {roleLabel(role)}</span>
		{/snippet}
	</PageHeader>

	<ResourceStateBanner state={viewState} {onReload} />
	{#if actionError}
		<p class="text-sm text-destructive" role="alert" data-testid="team-action-error">
			{actionError}
		</p>
	{/if}

	{#if showContent}
		<Card.Root>
			<Card.Header>
				<Card.Title>Invite teammates</Card.Title>
				<Card.Description>
					Invitations expire automatically. Resending invalidates the previous link.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<TeamInvitations
					{invitations}
					actorRole={role === 'owner' ? 'owner' : 'admin'}
					errorMessage={actionError}
					{outboundReady}
					{onInvite}
					onRevoke={onRevokeInvitation}
					onResend={onResendInvitation}
				/>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>Active members</Card.Title>
				<Card.Description>People who can currently access this organisation.</Card.Description>
			</Card.Header>
			<Card.Content>{@render memberList(activeMembers, 'active')}</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>Suspended members</Card.Title>
				<Card.Description
					>Suspended members remain listed but cannot access the workspace.</Card.Description
				>
			</Card.Header>
			<Card.Content>{@render memberList(suspendedMembers, 'suspended')}</Card.Content>
		</Card.Root>
	{/if}
</div>

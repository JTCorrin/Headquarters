<script lang="ts">
	import type { ApiOrganisationAccessRole, ApiOrganisationInvitation } from '$lib/api/v1/types.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import StatusBadge from './status-badge.svelte';

	export interface TeamInvitationsProps {
		invitations?: ApiOrganisationInvitation[];
		actorRole?: 'owner' | 'admin';
		errorMessage?: string | null;
		loading?: boolean;
		onInvite?: (
			email: string,
			role: ApiOrganisationAccessRole
		) => boolean | void | Promise<boolean | void>;
		onRevoke?: (invitation: ApiOrganisationInvitation) => boolean | void | Promise<boolean | void>;
		onResend?: (invitation: ApiOrganisationInvitation) => boolean | void | Promise<boolean | void>;
	}

	let {
		invitations = [],
		actorRole = 'owner',
		errorMessage = null,
		loading = false,
		onInvite,
		onRevoke,
		onResend
	}: TeamInvitationsProps = $props();

	let email = $state('');
	let role = $state<ApiOrganisationAccessRole>('member');
	let busyAction = $state<string | null>(null);
	let localError = $state<string | null>(null);

	const roleOptions = $derived(
		actorRole === 'owner'
			? (['admin', 'member', 'billing', 'readonly'] as const)
			: (['member', 'billing', 'readonly'] as const)
	);

	function roleLabel(value: ApiOrganisationAccessRole): string {
		if (value === 'readonly') return 'Read-only';
		return value.charAt(0).toUpperCase() + value.slice(1);
	}

	function formatExpiry(value: string): string {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return value;
		return date.toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	async function submitInvite(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const normalizedEmail = email.trim().toLowerCase();
		localError = null;
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
			localError = 'Enter a valid email address.';
			return;
		}
		busyAction = 'create';
		try {
			const result = await onInvite?.(normalizedEmail, role);
			if (result !== false) email = '';
		} finally {
			busyAction = null;
		}
	}

	async function revoke(invitation: ApiOrganisationInvitation): Promise<void> {
		if (!window.confirm(`Revoke the invitation for ${invitation.email}?`)) return;
		busyAction = `revoke:${invitation.id}`;
		try {
			await onRevoke?.(invitation);
		} finally {
			busyAction = null;
		}
	}

	async function resend(invitation: ApiOrganisationInvitation): Promise<void> {
		if (
			!window.confirm(
				`Resend the invitation to ${invitation.email}? The previous link will stop working.`
			)
		)
			return;
		busyAction = `resend:${invitation.id}`;
		try {
			await onResend?.(invitation);
		} finally {
			busyAction = null;
		}
	}
</script>

<div class="space-y-6" data-testid="team-invitations">
	<form
		class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem_auto]"
		onsubmit={submitInvite}
		novalidate
	>
		<div class="space-y-2">
			<Label for="team-invite-email">Email address</Label>
			<Input
				id="team-invite-email"
				name="email"
				type="email"
				autocomplete="email"
				placeholder="teammate@example.com"
				bind:value={email}
				disabled={loading || busyAction !== null}
				required
				data-testid="team-invite-email"
			/>
		</div>
		<div class="space-y-2">
			<Label for="team-invite-role">Role</Label>
			<select
				id="team-invite-role"
				name="role"
				class="h-9 w-full rounded-3xl bg-input/50 px-3 text-sm ring-1 ring-transparent outline-none focus:ring-ring"
				bind:value={role}
				disabled={loading || busyAction !== null}
				data-testid="team-invite-role"
			>
				{#each roleOptions as option (option)}
					<option value={option}>{roleLabel(option)}</option>
				{/each}
			</select>
		</div>
		<div class="flex items-end">
			<Button
				type="submit"
				class="w-full"
				disabled={loading || busyAction !== null}
				data-testid="team-invite-submit"
			>
				{busyAction === 'create' ? 'Sending…' : 'Send invite'}
			</Button>
		</div>
	</form>

	{#if localError || errorMessage}
		<p class="text-sm text-destructive" role="alert" data-testid="team-invite-error">
			{localError ?? errorMessage}
		</p>
	{/if}

	<div class="space-y-3">
		<h3 class="font-medium">Pending invitations</h3>
		{#if loading}
			<p class="text-sm text-muted-foreground">Loading invitations…</p>
		{:else if invitations.length === 0}
			<p class="text-sm text-muted-foreground" data-testid="team-invitations-empty">
				No pending invitations.
			</p>
		{:else}
			<ul class="divide-y divide-border rounded-3xl border" data-testid="team-invitations-list">
				{#each invitations as invitation (invitation.id)}
					<li
						class="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
						data-testid={`team-invitation-${invitation.id}`}
					>
						<div class="min-w-0 space-y-1">
							<div class="flex flex-wrap items-center gap-2">
								<p class="truncate font-medium">{invitation.email}</p>
								<StatusBadge status="Pending" />
								<span class="text-xs text-muted-foreground">{roleLabel(invitation.role)}</span>
							</div>
							<p class="text-xs text-muted-foreground">
								Expires {formatExpiry(invitation.expires_at)}
							</p>
						</div>
						<div class="flex gap-2">
							{#if onResend}
								<Button
									type="button"
									size="sm"
									variant="outline"
									disabled={busyAction !== null}
									onclick={() => resend(invitation)}
									data-testid={`team-invitation-resend-${invitation.id}`}
								>
									{busyAction === `resend:${invitation.id}` ? 'Resending…' : 'Resend'}
								</Button>
							{/if}
							<Button
								type="button"
								size="sm"
								variant="ghost"
								disabled={busyAction !== null}
								onclick={() => revoke(invitation)}
								data-testid={`team-invitation-revoke-${invitation.id}`}
							>
								{busyAction === `revoke:${invitation.id}` ? 'Revoking…' : 'Revoke'}
							</Button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import type { ApiOrganisationAccessRole, ApiOrganisationInvitation } from '$lib/api/v1/types.js';
	import TeamInvitations from '$lib/components/crm/team-invitations.svelte';
	import PageHeader from '$lib/components/crm/page-header.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { getOrgSession } from '$lib/org/index.js';

	const api = getApiV1Client();
	const session = getOrgSession();
	let invitations = $state<ApiOrganisationInvitation[]>([]);
	let loading = $state(true);
	let errorMessage = $state<string | null>(null);

	function message(error: unknown, fallback: string): string {
		if (isApiClientError(error)) return error.message || fallback;
		return fallback;
	}

	async function loadInvitations(): Promise<void> {
		loading = true;
		errorMessage = null;
		try {
			const rows = await api.organisationAccess.listInvitations();
			invitations = rows.filter((row) => !row.accepted_at && !row.revoked_at);
		} catch (error) {
			errorMessage = message(error, 'Could not load invitations.');
		} finally {
			loading = false;
		}
	}

	async function invite(email: string, role: ApiOrganisationAccessRole): Promise<boolean> {
		errorMessage = null;
		try {
			const created = await api.organisationAccess.invite({ email, role });
			invitations = [created, ...invitations];
			return true;
		} catch (error) {
			errorMessage = message(error, 'Could not send the invitation.');
			return false;
		}
	}

	async function revoke(invitation: ApiOrganisationInvitation): Promise<boolean> {
		errorMessage = null;
		try {
			await api.organisationAccess.revokeInvitation(invitation.id);
			invitations = invitations.filter((row) => row.id !== invitation.id);
			return true;
		} catch (error) {
			errorMessage = message(error, 'Could not revoke the invitation.');
			return false;
		}
	}

	onMount(() => {
		if (!session.selectedOrgId) {
			void goto(resolve('/onboarding/create-org'));
			return;
		}
		void loadInvitations();
	});
</script>

<div class="mx-auto flex min-h-[70vh] max-w-2xl flex-col justify-center gap-6 p-6">
	<PageHeader
		title="Invite your team"
		description="Add teammates now, or continue and manage them later from Organisation · Team."
	/>
	<Card.Root>
		<Card.Header>
			<Card.Title>Team invitations</Card.Title>
			<Card.Description
				>Invite people using the email address they will sign in with.</Card.Description
			>
		</Card.Header>
		<Card.Content>
			<TeamInvitations
				{invitations}
				actorRole="owner"
				{errorMessage}
				{loading}
				onInvite={invite}
				onRevoke={revoke}
			/>
		</Card.Content>
		<Card.Footer class="justify-end">
			<Button
				type="button"
				variant="outline"
				onclick={() => {
					void goto(resolve('/org/config'));
				}}
				data-testid="onboarding-invite-skip"
			>
				{invitations.length > 0 ? 'Continue' : 'Skip for now'}
			</Button>
		</Card.Footer>
	</Card.Root>
</div>

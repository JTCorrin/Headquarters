<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount, untrack } from 'svelte';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { toOrgMembershipSummary } from '$lib/api/v1/mappers.js';
	import { getAuthSession } from '$lib/auth/index.js';
	import { logoutAndRedirect } from '$lib/auth/logout.js';
	import PageHeader from '$lib/components/crm/page-header.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { getOrgSession } from '$lib/org/index.js';
	import type { ActionData, PageData } from './$types.js';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const api = getApiV1Client();
	const auth = getAuthSession();
	const orgSession = getOrgSession();
	let accepting = $state(false);
	let refreshing = $state(false);
	let refreshError = $state<string | null>(null);
	let acceptedOrganisationId = $state<string | null>(null);
	let logoutError = $state<string | null>(null);
	const acceptanceError = $derived(form?.error ?? data.error);
	const initialAcceptance = untrack(() => form?.acceptance);

	async function finishAcceptance(organisationId: string): Promise<void> {
		if (refreshing && acceptedOrganisationId === organisationId) return;
		if (acceptedOrganisationId === organisationId && !refreshError) return;
		acceptedOrganisationId = organisationId;
		refreshing = true;
		refreshError = null;
		try {
			const rows = await api.organisations.list();
			const memberships = rows.map(toOrgMembershipSummary);
			orgSession.setMemberships(memberships);
			if (!memberships.some((membership) => membership.org_id === organisationId)) {
				throw new Error('The accepted organisation is not available yet.');
			}
			orgSession.selectOrg(organisationId);
			void goto(resolve('/'));
		} catch {
			refreshError =
				'The invitation was accepted, but your workspace list could not be refreshed. Try again.';
			refreshing = false;
		}
	}

	async function useDifferentAccount(): Promise<void> {
		logoutError = null;
		const next = `${page.url.pathname}${page.url.search}`;
		logoutError = await logoutAndRedirect(
			auth,
			orgSession,
			resolve(`/login?next=${encodeURIComponent(next)}`)
		);
	}

	onMount(() => {
		if (initialAcceptance) void finishAcceptance(initialAcceptance.organisation_id);
	});
</script>

<div class="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center gap-6 p-6">
	<PageHeader
		title="Join organisation"
		description="Accept your invitation using the exact verified email address it was sent to."
	/>
	<Card.Root>
		<Card.Header>
			<Card.Title>
				{acceptedOrganisationId
					? 'Invitation accepted'
					: acceptanceError
						? 'Could not accept invitation'
						: 'Ready to join'}
			</Card.Title>
			<Card.Description>
				{#if refreshing}
					Refreshing your organisations…
				{:else if data.userEmail}
					Signed in as {data.userEmail}
				{:else}
					Check the invitation link and account you used.
				{/if}
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			{#if logoutError}
				<p class="text-sm text-destructive" role="alert">{logoutError}</p>
			{/if}
			{#if refreshError && acceptedOrganisationId}
				<p class="text-sm text-destructive" role="alert">{refreshError}</p>
				<Button
					type="button"
					onclick={() => {
						if (acceptedOrganisationId) void finishAcceptance(acceptedOrganisationId);
					}}
				>
					Retry refresh
				</Button>
			{:else if acceptanceError}
				<p class="text-sm text-destructive" role="alert" data-testid="invite-accept-error">
					{acceptanceError.message}
				</p>
				{#if acceptanceError.status === 403}
					<p class="text-sm text-muted-foreground">
						Sign out and use the exact email address that received the invitation. The invitation
						token has not been consumed.
					</p>
					<Button type="button" onclick={useDifferentAccount}>Use a different account</Button>
				{:else}
					<Button href="/login" variant="outline">Return to sign in</Button>
				{/if}
			{:else if acceptedOrganisationId}
				<p class="text-sm text-muted-foreground">Taking you to the accepted organisation…</p>
			{:else}
				<p class="text-sm text-muted-foreground">
					Continue only if you recognise this invitation and want to join the organisation.
				</p>
				<form
					method="POST"
					use:enhance={() => {
						accepting = true;
						return async ({ result, update }) => {
							accepting = false;
							const acceptance =
								result.type === 'success' ? (result.data as ActionData)?.acceptance : null;
							if (acceptance) {
								await finishAcceptance(acceptance.organisation_id);
								return;
							}
							await update({ reset: false, invalidateAll: false });
						};
					}}
				>
					<Button
						type="submit"
						disabled={accepting || refreshing}
						data-testid="invite-accept-submit"
					>
						{accepting ? 'Accepting…' : 'Accept invitation'}
					</Button>
				</form>
			{/if}
		</Card.Content>
	</Card.Root>
</div>

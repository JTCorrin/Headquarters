<script lang="ts">
	import { goto } from '$app/navigation';
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { getAuthSession } from '$lib/auth/index.js';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import { membershipFromCreateResult, toOrganisationCreateBody } from '$lib/api/v1/mappers.js';
	import OrganisationCreateForm from '$lib/components/crm/organisation-create-form.svelte';
	import PageHeader from '$lib/components/crm/page-header.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { getOrgSession } from '$lib/org/index.js';
	import { organisationCreateSchema } from '$lib/schemas/organisation.js';

	const api = getApiV1Client();
	const orgSession = getOrgSession();
	const auth = getAuthSession();
	let createError = $state<string | null>(null);

	const createForm = superForm(
		defaults(
			{
				name: '',
				slug: '',
				timezone: 'UTC',
				currency: 'GBP',
				locale: 'en-GB',
				country: 'GB'
			},
			zod4(organisationCreateSchema)
		),
		{
			validators: zod4(organisationCreateSchema),
			SPA: true,
			warnings: { duplicateId: false },
			applyAction: false,
			resetForm: false
		}
	);

	async function handleCreate(): Promise<boolean> {
		createError = null;
		try {
			const result = await api.organisations.create(
				toOrganisationCreateBody(get(createForm.form))
			);
			const membership = membershipFromCreateResult(result);
			orgSession.setMemberships([membership]);
			orgSession.selectOrg(membership.org_id);
			void goto('/org/config');
			return true;
		} catch (error) {
			if (isApiClientError(error)) {
				createError = error.message;
			} else {
				createError = 'Could not create organisation — try again.';
			}
			return false;
		}
	}

	async function handleLogout() {
		await auth.signOut();
		orgSession.clearSelection();
		orgSession.setMemberships([]);
		void goto('/login');
	}
</script>

<div class="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center gap-6 p-6">
	<div class="flex items-start justify-between gap-4">
		<PageHeader
			title="Create your organisation"
			description="Required to continue — this becomes your first workspace."
		/>
		<Button
			type="button"
			variant="outline"
			size="sm"
			onclick={() => {
				void handleLogout();
			}}
			data-testid="auth-logout"
		>
			Log out
		</Button>
	</div>

	<Card.Root>
		<Card.Header>
			<Card.Title>Organisation details</Card.Title>
			<Card.Description>You can invite teammates later.</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			{#if createError}
				<p class="text-destructive text-sm" role="alert" data-testid="onboarding-create-error">
					{createError}
				</p>
			{/if}
			<OrganisationCreateForm form={createForm} onValidSubmit={handleCreate} />
		</Card.Content>
	</Card.Root>
</div>

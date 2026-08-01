<script lang="ts">
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		membershipFromCreateResult,
		toOrganisationCreateBody,
		toOrgMembershipSummary
	} from '$lib/api/v1/mappers.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import {
		organisationCreateSchema,
		roleLabel
	} from '$lib/schemas/organisation.js';
	import PageHeader from './page-header.svelte';
	import OrganisationCreateDrawer from './organisation-create-drawer.svelte';
	import StatusBadge from './status-badge.svelte';
	import ResourceStateBanner, {
		type ResourceViewState
	} from './resource-state-banner.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface SelectOrgPageProps {
		api: ApiV1Client;
		session: OrgSession;
		/** Called after a successful select / create (e.g. navigate). */
		onSelected?: (orgId: string) => void;
		class?: string;
	}

	let { api, session, onSelected, class: className }: SelectOrgPageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let createError = $state<string | null>(null);
	let createOpen = $state(false);
	let selectingId = $state<string | null>(null);

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

	function userMessage(error: unknown, fallback: string): string {
		if (isApiClientError(error)) {
			if (error.isNetworkError) return 'Network error — check your connection and retry.';
			if (error.isForbidden) return 'You do not have access to that organisation.';
			if (error.isValidationError) {
				if (error.fields) return Object.values(error.fields).join(' · ') || error.message;
				return error.message;
			}
			return error.message || fallback;
		}
		return fallback;
	}

	async function loadMemberships() {
		viewState = { kind: 'loading' };
		try {
			const rows = await api.organisations.list();
			const memberships = rows.map(toOrgMembershipSummary);
			session.setMemberships(memberships);
			viewState =
				memberships.length === 0
					? { kind: 'empty', message: 'No organisations yet. Create one to get started.' }
					: { kind: 'ready' };
		} catch (error) {
			if (isApiClientError(error) && error.isForbidden) {
				viewState = { kind: 'forbidden', message: userMessage(error, 'Forbidden') };
				return;
			}
			if (isApiClientError(error) && error.isNetworkError) {
				viewState = {
					kind: 'validation',
					message: userMessage(error, 'Network error')
				};
				return;
			}
			viewState = {
				kind: 'validation',
				message: userMessage(error, 'Could not load organisations.')
			};
		}
	}

	function selectOrg(orgId: string) {
		selectingId = orgId;
		session.selectOrg(orgId);
		onSelected?.(orgId);
		selectingId = null;
	}

	async function handleCreate(): Promise<boolean> {
		createError = null;
		try {
			const result = await api.organisations.create(
				toOrganisationCreateBody(get(createForm.form))
			);
			const membership = membershipFromCreateResult(result);
			session.setMemberships([...session.memberships, membership]);
			session.selectOrg(membership.org_id);
			onSelected?.(membership.org_id);
			return true;
		} catch (error) {
			createError = userMessage(error, 'Could not create organisation — try again.');
			return false;
		}
	}

	$effect(() => {
		void loadMemberships();
	});
</script>

<div class={cn('mx-auto max-w-2xl space-y-6 p-6', className)} data-testid="select-org-page">
	<PageHeader
		title="Select organisation"
		description="Choose a workspace or create a new organisation."
	/>

	<ResourceStateBanner state={viewState} onRetry={loadMemberships} />

	{#if viewState.kind === 'ready' || viewState.kind === 'empty'}
		<ul class="space-y-2" data-testid="select-org-list">
			{#each session.memberships as membership (membership.org_id)}
				<li>
					<button
						type="button"
						class="hover:bg-muted/60 flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left"
						data-testid={`select-org-${membership.org_id}`}
						disabled={selectingId === membership.org_id}
						onclick={() => selectOrg(membership.org_id)}
					>
						<span class="min-w-0 flex-1 truncate font-medium">{membership.org_name}</span>
						<span class="text-muted-foreground truncate text-sm">{membership.org_slug}</span>
						<StatusBadge status={roleLabel(membership.role)} class="shrink-0" />
						{#if session.selectedOrgId === membership.org_id}
							<span class="text-muted-foreground text-xs" data-testid="select-org-current"
								>Current</span
							>
						{/if}
					</button>
				</li>
			{/each}
		</ul>

		<div class="flex flex-wrap gap-2">
			<Button
				type="button"
				onclick={() => {
					createOpen = true;
				}}
				data-testid="select-org-create"
			>
				Create organisation
			</Button>
		</div>
	{/if}

	<OrganisationCreateDrawer
		form={createForm}
		bind:open={createOpen}
		{createError}
		onValidSubmit={handleCreate}
	/>
</div>

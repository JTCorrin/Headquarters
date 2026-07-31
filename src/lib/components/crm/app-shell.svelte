<script lang="ts">
	import type { Snippet } from 'svelte';
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		organisationCreateSchema,
		type OrganisationCreateData,
		type OrgMembershipSummary
	} from '$lib/schemas/organisation.js';
	import OrgSwitcher from './org-switcher.svelte';
	import OrganisationCreateDrawer from './organisation-create-drawer.svelte';
	import { cn } from '$lib/utils.js';

	export interface AppShellProps {
		currentOrgId: string;
		memberships: OrgMembershipSummary[];
		switchError?: string | null;
		busy?: boolean;
		createError?: string | null;
		class?: string;
		children?: Snippet;
		headerExtra?: Snippet;
		onSwitchOrg?: (orgId: string) => void;
		onValidCreate?: (
			data: OrganisationCreateData
		) => boolean | void | Promise<boolean | void>;
	}

	let {
		currentOrgId,
		memberships,
		switchError = null,
		busy = false,
		createError = null,
		class: className,
		children,
		headerExtra,
		onSwitchOrg,
		onValidCreate
	}: AppShellProps = $props();

	let createOpen = $state(false);

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
		const data = get(createForm.form);
		const result = await onValidCreate?.(data);
		return result === false ? false : true;
	}
</script>

<div
	class={cn('bg-background text-foreground flex h-full min-h-[720px] flex-col', className)}
	data-testid="app-shell"
>
	<header
		class="flex flex-wrap items-center gap-3 border-b px-4 py-3"
		data-testid="app-shell-header"
	>
		<OrgSwitcher
			{currentOrgId}
			{memberships}
			{switchError}
			{busy}
			onSwitchOrg={onSwitchOrg}
			onCreateOrg={() => {
				createOpen = true;
			}}
		/>
		{#if headerExtra}
			<div class="ms-auto">{@render headerExtra()}</div>
		{/if}
	</header>
	<main class="min-h-0 flex-1 overflow-auto" data-testid="app-shell-main">
		{#if children}
			{@render children()}
		{/if}
	</main>

	<OrganisationCreateDrawer
		form={createForm}
		bind:open={createOpen}
		{createError}
		onValidSubmit={handleCreate}
	/>
</div>

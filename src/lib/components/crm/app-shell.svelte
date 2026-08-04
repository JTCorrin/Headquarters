<script lang="ts">
	import type { Snippet } from 'svelte';
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { getOptionalApiV1Client } from '$lib/api/v1/context.js';
	import {
		canAccessPersonalConfig,
		organisationCreateSchema,
		type MembershipRole,
		type OrganisationCreateData,
		type OrgMembershipSummary
	} from '$lib/schemas/organisation.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import NotificationsBell from './notifications-bell.svelte';
	import OrgSwitcher from './org-switcher.svelte';
	import OrganisationCreateDrawer from './organisation-create-drawer.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface AppShellProps {
		currentOrgId: string;
		memberships: OrgMembershipSummary[];
		/** When set with navGroups, AppNav spans the full browser/window height. */
		orgName?: string;
		navGroups?: AppNavGroup[];
		/** Optional override; defaults to layout ApiV1Client context when present. */
		api?: ApiV1Client | null;
		switchError?: string | null;
		busy?: boolean;
		createError?: string | null;
		class?: string;
		children?: Snippet;
		headerExtra?: Snippet;
		onSwitchOrg?: (orgId: string) => void;
		onLogout?: () => void | Promise<void>;
		onValidCreate?: (
			data: OrganisationCreateData
		) => boolean | void | Promise<boolean | void>;
	}

	let {
		currentOrgId,
		memberships,
		orgName,
		navGroups,
		api = null,
		switchError = null,
		busy = false,
		createError = null,
		class: className,
		children,
		headerExtra,
		onSwitchOrg,
		onLogout,
		onValidCreate
	}: AppShellProps = $props();

	const resolvedApi = $derived(api ?? getOptionalApiV1Client());
	const membershipRole = $derived(
		(memberships.find((m) => m.org_id === currentOrgId)?.role ?? null) as MembershipRole | null
	);
	const showNotifications = $derived(
		Boolean(resolvedApi && currentOrgId && membershipRole && canAccessPersonalConfig(membershipRole))
	);

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

	const showNav = $derived(Boolean(orgName && navGroups && navGroups.length > 0));
</script>

<div
	class={cn('bg-background text-foreground flex h-svh overflow-hidden', className)}
	data-testid="app-shell"
>
	{#if showNav && orgName && navGroups}
		<AppNav {orgName} groups={navGroups} class="h-svh shrink-0" />
	{/if}

	<div class="flex min-h-0 min-w-0 flex-1 flex-col">
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
			<div class="ms-auto flex items-center gap-2">
				{#if showNotifications && resolvedApi}
					<NotificationsBell api={resolvedApi} orgId={currentOrgId} />
				{/if}
				{#if headerExtra}
					{@render headerExtra()}
				{/if}
				{#if onLogout}
					<Button
						type="button"
						variant="outline"
						size="sm"
						onclick={() => {
							void onLogout();
						}}
						data-testid="auth-logout"
					>
						Log out
					</Button>
				{/if}
			</div>
		</header>
		<main class="flex min-h-0 flex-1 flex-col overflow-auto" data-testid="app-shell-main">
			{#if children}
				{@render children()}
			{/if}
		</main>
	</div>

	<OrganisationCreateDrawer
		form={createForm}
		bind:open={createOpen}
		{createError}
		onValidSubmit={handleCreate}
	/>
</div>

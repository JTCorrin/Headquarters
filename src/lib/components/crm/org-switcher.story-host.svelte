<script lang="ts">
	import { get } from 'svelte/store';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		organisationCreateSchema,
		type OrgMembershipSummary
	} from '$lib/schemas/organisation.js';
	import OrgSwitcher from './org-switcher.svelte';
	import OrganisationCreateDrawer from './organisation-create-drawer.svelte';

	export interface OrgSwitcherStoryHostProps {
		currentOrgId?: string;
		memberships?: OrgMembershipSummary[];
		switchError?: string | null;
		/** Simulate API create failure via resolved `false`. */
		failCreate?: boolean;
		/** Simulate API create failure via rejected promise. */
		rejectCreate?: boolean;
		/** Artificial create latency in ms (keeps submitting true while pending). */
		createDelayMs?: number;
		class?: string;
		onOpenedConfig?: (orgId: string) => void;
		onCreateAttempt?: () => void;
	}

	let {
		currentOrgId: initialOrgId = '',
		memberships: initialMemberships = [],
		switchError = null,
		failCreate = false,
		rejectCreate = false,
		createDelayMs = 0,
		class: className,
		onOpenedConfig,
		onCreateAttempt
	}: OrgSwitcherStoryHostProps = $props();

	let currentOrgId = $state(initialOrgId);
	let memberships = $state<OrgMembershipSummary[]>([...initialMemberships]);
	let localSwitchError = $state<string | null>(switchError);
	let createOpen = $state(false);
	let createError = $state<string | null>(null);
	let openedConfigOrgId = $state<string | null>(null);

	$effect(() => {
		localSwitchError = switchError;
	});

	$effect(() => {
		memberships = [...initialMemberships];
	});

	$effect(() => {
		if (initialOrgId) currentOrgId = initialOrgId;
	});

	const createForm = superForm(
		defaults(
			{
				name: '',
				slug: '',
				timezone: 'Europe/London',
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
		onCreateAttempt?.();
		createError = null;
		if (createDelayMs > 0) {
			await new Promise((resolve) => setTimeout(resolve, createDelayMs));
		}
		if (rejectCreate) {
			throw new Error('Could not create organisation — try again.');
		}
		if (failCreate) {
			createError = 'Could not create organisation — try again.';
			return false;
		}

		const snapshot = get(createForm.form);
		const orgId = crypto.randomUUID();
		const created: OrgMembershipSummary = {
			org_id: orgId,
			org_name: snapshot.name,
			org_slug: snapshot.slug,
			role: 'owner',
			theme_default: 'system'
		};
		memberships = [...memberships, created];
		currentOrgId = orgId;
		openedConfigOrgId = orgId;
		onOpenedConfig?.(orgId);
		return true;
	}
</script>

<div class={['space-y-3', className]} data-testid="org-switcher-host">
	<OrgSwitcher
		{currentOrgId}
		{memberships}
		switchError={localSwitchError}
		onSwitchOrg={(orgId) => {
			localSwitchError = null;
			currentOrgId = orgId;
		}}
		onCreateOrg={() => {
			createError = null;
			createOpen = true;
		}}
	/>
	<OrganisationCreateDrawer
		bind:open={createOpen}
		form={createForm}
		{createError}
		onValidSubmit={handleCreate}
	/>
	{#if openedConfigOrgId}
		<p class="text-muted-foreground text-sm" data-testid="org-create-opened-config">
			Opened configuration for
			{memberships.find((m) => m.org_id === openedConfigOrgId)?.org_name ?? openedConfigOrgId}
		</p>
	{/if}
</div>

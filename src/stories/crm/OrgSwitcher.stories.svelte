<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import OrgSwitcher from '$lib/components/crm/org-switcher.svelte';
	import type { OrgMembershipSummary } from '$lib/schemas/organisation.js';

	const corrin = {
		org_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
		org_name: 'Corrin Data',
		org_slug: 'corrin-data',
		role: 'owner'
	} satisfies OrgMembershipSummary;

	const certivue = {
		org_id: '11111111-2222-4333-8444-555555555555',
		org_name: 'Certivue Extremely Long Organisation Name That Truncates Nicely',
		org_slug: 'certivue',
		role: 'member'
	} satisfies OrgMembershipSummary;

	const memberships = [corrin, certivue];

	const { Story } = defineMeta({
		title: 'Headquarters/Chrome/OrgSwitcher',
		component: OrgSwitcher,
		tags: ['autodocs'],
		parameters: { layout: 'centered' },
		args: {
			currentOrgId: corrin.org_id,
			memberships
		}
	});
</script>

<script lang="ts">
	import OrganisationCreateDrawer from '$lib/components/crm/organisation-create-drawer.svelte';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { organisationCreateSchema } from '$lib/schemas/organisation.js';

	let currentOrgId = $state(corrin.org_id);
	let switchError = $state<string | null>(null);
	let createOpen = $state(false);

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
</script>

<Story name="SingleOrg" args={{ memberships: [corrin], currentOrgId: corrin.org_id }}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/org-switcher.svelte').OrgSwitcherProps} */ (args)}
		<div class="w-80 p-6">
			<OrgSwitcher {...props} />
		</div>
	{/snippet}
</Story>

<Story name="MultiOrg">
	{#snippet template()}
		<div class="w-80 space-y-4 p-6">
			<OrgSwitcher
				{currentOrgId}
				{memberships}
				{switchError}
				onSwitchOrg={(orgId) => {
					switchError = null;
					currentOrgId = orgId;
				}}
				onCreateOrg={() => {
					createOpen = true;
				}}
			/>
			<OrganisationCreateDrawer bind:open={createOpen} form={createForm} />
		</div>
	{/snippet}
</Story>

<Story name="SwitchFailure" args={{ switchError: 'Could not switch organisation — try again.' }}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/org-switcher.svelte').OrgSwitcherProps} */ (args)}
		<div class="w-80 p-6">
			<OrgSwitcher {...props} />
		</div>
	{/snippet}
</Story>

<Story name="Empty" args={{ memberships: [], currentOrgId: '' }}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/org-switcher.svelte').OrgSwitcherProps} */ (args)}
		<div class="w-80 p-6">
			<OrgSwitcher {...props} />
		</div>
	{/snippet}
</Story>

<Story name="Dark" parameters={{ themes: { themeOverride: 'dark' } }}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/org-switcher.svelte').OrgSwitcherProps} */ (args)}
		<div class="bg-background w-80 p-6">
			<OrgSwitcher {...props} />
		</div>
	{/snippet}
</Story>

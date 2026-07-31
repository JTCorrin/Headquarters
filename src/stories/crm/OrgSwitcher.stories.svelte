<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import OrgSwitcherStoryHost from '$lib/components/crm/org-switcher.story-host.svelte';
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
		component: OrgSwitcherStoryHost,
		tags: ['autodocs'],
		parameters: { layout: 'centered' },
		args: {
			currentOrgId: corrin.org_id,
			memberships
		}
	});
</script>

<script lang="ts">
	import OrgSwitcher from '$lib/components/crm/org-switcher.svelte';
</script>

<Story name="SingleOrg" args={{ memberships: [corrin], currentOrgId: corrin.org_id }}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/org-switcher.story-host.svelte').OrgSwitcherStoryHostProps} */ (
				args
			)}
		<div class="w-80 p-6">
			<OrgSwitcherStoryHost {...props} />
		</div>
	{/snippet}
</Story>

<Story name="MultiOrg">
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/org-switcher.story-host.svelte').OrgSwitcherStoryHostProps} */ (
				args
			)}
		<div class="w-80 p-6">
			<OrgSwitcherStoryHost {...props} />
		</div>
	{/snippet}
</Story>

<Story name="CreateFailure" args={{ failCreate: true }}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/org-switcher.story-host.svelte').OrgSwitcherStoryHostProps} */ (
				args
			)}
		<div class="w-80 p-6">
			<OrgSwitcherStoryHost {...props} />
		</div>
	{/snippet}
</Story>

<Story name="SwitchFailure">
	{#snippet template()}
		<div class="w-80 p-6">
			<OrgSwitcher
				currentOrgId={corrin.org_id}
				{memberships}
				switchError="Could not switch organisation — try again."
			/>
		</div>
	{/snippet}
</Story>

<Story name="Empty" args={{ memberships: [], currentOrgId: '' }}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/org-switcher.story-host.svelte').OrgSwitcherStoryHostProps} */ (
				args
			)}
		<div class="w-80 p-6">
			<OrgSwitcherStoryHost {...props} />
		</div>
	{/snippet}
</Story>

<Story name="Dark" parameters={{ themes: { themeOverride: 'dark' } }}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/org-switcher.story-host.svelte').OrgSwitcherStoryHostProps} */ (
				args
			)}
		<div class="bg-background w-80 p-6">
			<OrgSwitcherStoryHost {...props} />
		</div>
	{/snippet}
</Story>

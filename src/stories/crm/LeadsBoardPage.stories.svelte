<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import LeadsBoardPageStoryHost from '$lib/components/crm/leads-board-page.story-host.svelte';
	import { navGroupsWithActive } from './story-fixtures.js';

	const leads = [
		{
			id: '1',
			name: 'Contoso expansion',
			companyName: 'Contoso',
			valueCents: 1_800_000,
			currency: 'GBP',
			owner: 'Joe',
			stage: 'new',
			version: 1
		},
		{
			id: '2',
			name: 'Fabrikam pilot',
			companyName: 'Fabrikam',
			valueCents: 650_000,
			currency: 'GBP',
			owner: 'Maya',
			stage: 'qualified',
			version: 2
		},
		{
			id: '3',
			name: 'Litware retainer',
			companyName: 'Litware',
			valueCents: 420_000,
			currency: 'GBP',
			owner: 'Joe',
			stage: 'proposal',
			version: 1
		},
		{
			id: '4',
			name: 'Northwind upsell',
			companyName: 'Northwind',
			valueCents: 900_000,
			currency: 'GBP',
			owner: 'Joe',
			stage: 'won',
			version: 4
		},
		{
			id: '5',
			name: 'Old town cafe',
			companyName: 'Old Town',
			valueCents: 120_000,
			currency: 'GBP',
			owner: 'Maya',
			stage: 'lost',
			version: 2
		}
	];

	const { Story } = defineMeta({
		title: 'Headquarters/Pages/LeadsBoard',
		component: LeadsBoardPageStoryHost,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' },
		args: {
			orgName: 'Acme Org',
			navGroups: navGroupsWithActive('Leads'),
			leads
		}
	});
</script>

<Story name="Default">
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/leads-board-page.story-host.svelte').LeadsBoardPageStoryHostProps} */ (
				args
			)}
		<div class="h-screen">
			<LeadsBoardPageStoryHost {...props} />
		</div>
	{/snippet}
</Story>

<Story name="Empty" args={{ leads: [], viewState: { kind: 'empty' } }}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/leads-board-page.story-host.svelte').LeadsBoardPageStoryHostProps} */ (
				args
			)}
		<div class="h-screen">
			<LeadsBoardPageStoryHost {...props} />
		</div>
	{/snippet}
</Story>

<Story name="Loading" args={{ leads: [], viewState: { kind: 'loading' } }}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/leads-board-page.story-host.svelte').LeadsBoardPageStoryHostProps} */ (
				args
			)}
		<div class="h-screen">
			<LeadsBoardPageStoryHost {...props} />
		</div>
	{/snippet}
</Story>

<Story
	name="Forbidden"
	args={{
		leads: [],
		viewState: { kind: 'forbidden', message: 'Billing role cannot mutate leads.' }
	}}
>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/leads-board-page.story-host.svelte').LeadsBoardPageStoryHostProps} */ (
				args
			)}
		<div class="h-screen">
			<LeadsBoardPageStoryHost {...props} />
		</div>
	{/snippet}
</Story>

<Story name="Dark">
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/leads-board-page.story-host.svelte').LeadsBoardPageStoryHostProps} */ (
				args
			)}
		<div class="h-screen dark">
			<LeadsBoardPageStoryHost {...props} />
		</div>
	{/snippet}
</Story>

<Story
	name="ValidationBanner"
	args={{
		viewState: {
			kind: 'validation',
			message: 'Lead validation failed',
			fields: { lost_reason: 'Required when stage is lost' }
		}
	}}
>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/leads-board-page.story-host.svelte').LeadsBoardPageStoryHostProps} */ (
				args
			)}
		<div class="h-screen">
			<LeadsBoardPageStoryHost {...props} />
		</div>
	{/snippet}
</Story>

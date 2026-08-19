<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ClientsListPageStoryHost from '$lib/components/crm/clients-list-page.story-host.svelte';
	import { navGroupsWithActive, storyViewport } from './story-fixtures.js';

	const rows = [
		{
			id: '1',
			name: 'Northwind',
			status: 'Active',
			owner: 'Joe',
			openInvoices: '£4,200',
			pipeline: '£18k',
			people: [
				{ id: 'c1', name: 'Ava Chen' },
				{ id: 'c2', name: 'Northwind Billing' }
			]
		},
		{
			id: '2',
			name: 'Contoso',
			status: 'Prospect',
			owner: 'Maya',
			openInvoices: '—',
			pipeline: '£12k',
			people: [{ id: 'c3', name: 'Priya Shah' }]
		},
		{
			id: '3',
			name: 'Fabrikam',
			status: 'At risk',
			owner: 'Joe',
			openInvoices: '£6,500',
			pipeline: '£12k',
			people: []
		}
	];

	const { Story } = defineMeta({
		title: 'Headquarters/Pages/ClientsList',
		component: ClientsListPageStoryHost,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' },
		args: {
			orgName: 'Acme Org',
			navGroups: navGroupsWithActive('Clients'),
			rows
		}
	});
</script>

<Story name="Default">
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/clients-list-page.story-host.svelte').ClientsListPageStoryHostProps} */ (
				args
			)}
		<div class="h-screen">
			<ClientsListPageStoryHost {...props} />
		</div>
	{/snippet}
</Story>

<Story name="Desktop" globals={storyViewport.desktop}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/clients-list-page.story-host.svelte').ClientsListPageStoryHostProps} */ (
				args
			)}
		<div class="h-screen">
			<ClientsListPageStoryHost {...props} />
		</div>
	{/snippet}
</Story>

<Story name="Mobile" globals={storyViewport.mobile}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/clients-list-page.story-host.svelte').ClientsListPageStoryHostProps} */ (
				args
			)}
		<div class="h-screen">
			<ClientsListPageStoryHost {...props} />
		</div>
	{/snippet}
</Story>

<Story name="Empty" args={{ rows: [], viewState: { kind: 'empty' } }}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/clients-list-page.story-host.svelte').ClientsListPageStoryHostProps} */ (
				args
			)}
		<div class="h-screen">
			<ClientsListPageStoryHost {...props} />
		</div>
	{/snippet}
</Story>

<Story name="Forbidden" args={{ rows: [], viewState: { kind: 'forbidden' } }}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/clients-list-page.story-host.svelte').ClientsListPageStoryHostProps} */ (
				args
			)}
		<div class="h-screen">
			<ClientsListPageStoryHost {...props} />
		</div>
	{/snippet}
</Story>

<Story
	name="Conflict412"
	args={{
		viewState: {
			kind: 'conflict',
			message: 'Client version does not match If-Match'
		}
	}}
>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/clients-list-page.story-host.svelte').ClientsListPageStoryHostProps} */ (
				args
			)}
		<div class="h-screen">
			<ClientsListPageStoryHost {...props} />
		</div>
	{/snippet}
</Story>

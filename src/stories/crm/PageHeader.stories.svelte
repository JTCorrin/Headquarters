<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import PageHeader from '$lib/components/crm/page-header.svelte';

	const { Story } = defineMeta({
		title: 'Headquarters/PageHeader',
		component: PageHeader,
		tags: ['autodocs']
	});
</script>

<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
</script>

<Story name="Contacts">
	{#snippet children()}
		<PageHeader title="Contacts" description="People and companies in your pipeline">
			{#snippet actions()}
				<Button size="sm">+ New contact</Button>
			{/snippet}
		</PageHeader>
	{/snippet}
</Story>

<Story
	name="With breadcrumb"
	args={{
		breadcrumb: 'Clients / Northwind',
		title: 'Northwind',
		description: 'Owner Joe · Tags: retainer, EU'
	}}
/>

<Story
	name="With status"
	args={{
		breadcrumb: 'Accounting / Invoices',
		title: 'INV-0881 · Northwind',
		status: 'Sent',
		description: 'Header + lines, with chase / payment activity on the right.'
	}}
>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/page-header.svelte').PageHeaderProps} */ (args)}
		<PageHeader {...props}>
			{#snippet actions()}
				<Button variant="outline" size="sm">Chase</Button>
				<Button size="sm">Send</Button>
			{/snippet}
		</PageHeader>
	{/snippet}
</Story>

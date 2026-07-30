<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import PageHeader from '$lib/components/crm/page-header.svelte';

	const { Story } = defineMeta({
		title: 'CRM/PageHeader',
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

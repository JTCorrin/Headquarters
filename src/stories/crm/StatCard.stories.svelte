<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import StatCard from '$lib/components/crm/stat-card.svelte';

	const { Story } = defineMeta({
		title: 'CRM/StatCard',
		component: StatCard,
		tags: ['autodocs']
	});
</script>

<Story name="Open leads" args={{ label: 'Open leads', value: '24', hint: 'Across all owners' }} />
<Story name="Unpaid" args={{ label: 'Invoices unpaid', value: '£18.4k' }} />

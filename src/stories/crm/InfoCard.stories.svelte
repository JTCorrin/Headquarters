<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import InfoCard from '$lib/components/crm/info-card.svelte';

	const { Story } = defineMeta({
		title: 'CRM/InfoCard',
		component: InfoCard,
		tags: ['autodocs']
	});
</script>

<Story
	name="Company info"
	args={{
		title: 'Company info',
		fields: [
			{ label: 'Website', value: 'northwind.com' },
			{ label: 'Industry', value: 'Wholesale / logistics' },
			{ label: 'Billing address', value: '12 Harbour Rd, London' }
		]
	}}
/>

<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import StatusBadge from '$lib/components/crm/status-badge.svelte';

	const { Story } = defineMeta({
		title: 'Headquarters/StatusBadge',
		component: StatusBadge,
		tags: ['autodocs']
	});
</script>

<Story name="Lead" args={{ status: 'Lead' }} />
<Story name="Client" args={{ status: 'Client' }} />
<Story name="Paid" args={{ status: 'Paid' }} />
<Story name="Overdue" args={{ status: 'Overdue' }} />

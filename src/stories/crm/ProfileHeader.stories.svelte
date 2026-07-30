<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ProfileHeader from '$lib/components/crm/profile-header.svelte';

	const { Story } = defineMeta({
		title: 'CRM/ProfileHeader',
		component: ProfileHeader,
		tags: ['autodocs']
	});
</script>

<Story
	name="Client"
	args={{
		breadcrumb: 'Clients / Northwind',
		title: 'Northwind',
		status: 'Client',
		subtitle: 'Owner Joe · Tags: retainer, EU'
	}}
/>

<Story
	name="Contact"
	args={{
		breadcrumb: 'Contacts / Ava Chen',
		title: 'Ava Chen',
		status: 'Contact',
		subtitle: 'Primary at Northwind · Owner Joe'
	}}
/>

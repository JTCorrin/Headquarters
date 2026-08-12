<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { contactFormSchema } from '$lib/schemas/contact.js';
	import ContactProfilePage from './contact-profile-page.svelte';
	import type { AppNavGroup } from './app-nav.svelte';

	export interface ContactProfileEditTestHostProps {
		orgName: string;
		navGroups: AppNavGroup[];
	}

	let { orgName, navGroups }: ContactProfileEditTestHostProps = $props();

	const contactForm = superForm(
		defaults(
			{
				name: 'Ava Chen',
				email: 'ava@northwind.com',
				phone: '',
				company: 'Northwind',
				title: '',
				status: 'active' as const,
				clientId: ''
			},
			zod4(contactFormSchema)
		),
		{
			validators: zod4(contactFormSchema),
			SPA: true,
			warnings: { duplicateId: false },
			applyAction: false,
			resetForm: false
		}
	);
</script>

<ContactProfilePage
	{orgName}
	{navGroups}
	breadcrumb="Contacts / Ava Chen"
	title="Ava Chen"
	status="Active"
	contactFields={[{ label: 'Email', value: 'ava@northwind.com' }]}
	companyFields={[{ label: 'Company', value: 'Northwind' }]}
	{contactForm}
	onValidSubmit={async () => true}
	showNav={false}
/>

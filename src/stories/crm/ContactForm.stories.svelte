<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ContactForm from '$lib/components/crm/contact-form.svelte';

	const { Story } = defineMeta({
		title: 'CRM/ContactForm',
		component: ContactForm,
		tags: ['autodocs']
	});
</script>

<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { contactFormSchema } from '$lib/schemas/contact.js';

	const data = defaults(
		{
			name: '',
			email: '',
			phone: '',
			company: '',
			title: '',
			status: 'contact'
		},
		zod4(contactFormSchema)
	);

	const form = superForm(data, {
		validators: zod4(contactFormSchema),
		SPA: true,
		resetForm: false,
		onUpdate({ form: f }) {
			if (f.valid) {
				console.info('Contact form valid', f.data);
			}
		}
	});
</script>

<Story name="Empty">
	{#snippet children()}
		<div class="bg-background max-w-lg rounded-2xl p-6 shadow-sm ring-1 ring-foreground/5">
			<ContactForm {form} />
		</div>
	{/snippet}
</Story>

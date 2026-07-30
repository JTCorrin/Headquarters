<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ContactFormDrawer from '$lib/components/crm/contact-form-drawer.svelte';

	const { Story } = defineMeta({
		title: 'CRM/ContactForm',
		component: ContactFormDrawer,
		tags: ['autodocs'],
		parameters: {
			layout: 'fullscreen'
		}
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

	let open = $state(true);
</script>

<Story name="Drawer">
	{#snippet template()}
		<div class="bg-background flex h-[560px] items-start justify-center p-8">
			<ContactFormDrawer bind:open {form} title="New contact" triggerLabel="New contact" />
		</div>
	{/snippet}
</Story>

<Story name="Drawer closed">
	{#snippet template()}
		<div class="bg-background flex h-[280px] items-start justify-center p-8">
			<ContactFormDrawer open={false} {form} title="New contact" triggerLabel="New contact" />
		</div>
	{/snippet}
</Story>

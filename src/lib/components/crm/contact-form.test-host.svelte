<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { contactFormSchema, type ContactFormData } from '$lib/schemas/contact.js';
	import type { LeadClientOption } from '$lib/schemas/lead.js';
	import ContactForm from './contact-form.svelte';

	export interface ContactFormTestHostProps {
		initial?: Partial<ContactFormData>;
		clientOptions?: LeadClientOption[];
	}

	let { initial = {}, clientOptions = [] }: ContactFormTestHostProps = $props();

	const form = superForm(
		defaults(
			{
				name: '',
				email: '',
				phone: '',
				company: '',
				title: '',
				status: 'active',
				clientId: '',
				...initial
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

<ContactForm {form} {clientOptions} />

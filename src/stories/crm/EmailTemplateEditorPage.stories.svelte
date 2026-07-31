<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import EmailTemplateEditorPage from '$lib/components/crm/email-template-editor-page.svelte';

	const { Story } = defineMeta({
		title: 'Headquarters/Pages/EmailTemplateEditor',
		component: EmailTemplateEditorPage,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' }
	});
</script>

<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { emailTemplateFormSchema } from '$lib/schemas/email-template.js';
	import { navGroupsWithActive } from './story-fixtures.js';

	const data = defaults(
		{
			name: 'Invoice chase #1',
			subject: 'Quick nudge on {{invoice.number}}',
			body: 'Hi {{contact.name}},\n\nJust a friendly reminder that {{invoice.number}} for {{client.name}} is still open.\n\nHappy to jump on a call if useful.\n\n— Acme',
			category: 'chase',
			status: 'active'
		},
		zod4(emailTemplateFormSchema)
	);

	const form = superForm(data, {
		validators: zod4(emailTemplateFormSchema),
		SPA: true,
		resetForm: false
	});
</script>

<Story name="Default">
	{#snippet template()}
		<div class="h-screen">
			<EmailTemplateEditorPage
				orgName="Acme Org"
				navGroups={navGroupsWithActive('Templates')}
				title="Invoice chase #1"
				status="Active"
				{form}
			/>
		</div>
	{/snippet}
</Story>

<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import EmailTemplatesListPage from '$lib/components/crm/email-templates-list-page.svelte';
	import { navGroupsWithActive } from './story-fixtures.js';

	const rows = [
		{
			id: '1',
			name: 'Invoice chase #1',
			subject: 'Quick nudge on {{invoice.number}}',
			category: 'chase',
			status: 'Active',
			updatedAt: 'Mar 12'
		},
		{
			id: '2',
			name: 'Client kickoff',
			subject: 'Welcome aboard, {{contact.name}}',
			category: 'onboarding',
			status: 'Active',
			updatedAt: 'Feb 28'
		},
		{
			id: '3',
			name: 'Quote follow-up',
			subject: 'Still thinking about {{quote.number}}?',
			category: 'chase',
			status: 'Draft',
			updatedAt: 'Mar 18'
		},
		{
			id: '4',
			name: 'Payment receipt',
			subject: 'Thanks — payment received',
			category: 'transactional',
			status: 'Active',
			updatedAt: 'Jan 9'
		}
	];

	const { Story } = defineMeta({
		title: 'Headquarters/Pages/EmailTemplatesList',
		component: EmailTemplatesListPage,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' },
		args: {
			orgName: 'Acme Org',
			navGroups: navGroupsWithActive('Templates'),
			rows
		}
	});
</script>

<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { emailTemplateFormSchema } from '$lib/schemas/email-template.js';

	const data = defaults(
		{
			name: '',
			subject: '',
			body: '',
			category: 'chase',
			status: 'draft'
		},
		zod4(emailTemplateFormSchema)
	);

	const form = superForm(data, {
		validators: zod4(emailTemplateFormSchema),
		SPA: true,
		warnings: { duplicateId: false },
		resetForm: false
	});
</script>

<Story name="Default">
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/email-templates-list-page.svelte').EmailTemplatesListPageProps} */ (
				args
			)}
		<div class="h-screen">
			<EmailTemplatesListPage {...props} {form} />
		</div>
	{/snippet}
</Story>

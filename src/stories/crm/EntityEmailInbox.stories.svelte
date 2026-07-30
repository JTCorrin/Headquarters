<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import EntityEmailInbox from '$lib/components/crm/entity-email-inbox.svelte';
	import { sampleEmailMessages } from './story-fixtures.js';

	const { Story } = defineMeta({
		title: 'CRM/EntityEmailInbox',
		component: EntityEmailInbox,
		tags: ['autodocs']
	});
</script>

<Story name="Default" args={{ messages: sampleEmailMessages }}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/entity-email-inbox.svelte').EntityEmailInboxProps} */ (
				args
			)}
		<div class="bg-background p-4">
			<EntityEmailInbox {...props} />
		</div>
	{/snippet}
</Story>

<Story name="Empty" args={{ messages: [] }}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/entity-email-inbox.svelte').EntityEmailInboxProps} */ (
				args
			)}
		<div class="bg-background p-4">
			<EntityEmailInbox {...props} />
		</div>
	{/snippet}
</Story>

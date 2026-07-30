<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ProfileTabs from '$lib/components/crm/profile-tabs.svelte';

	const tabs = [
		{ id: 'details', label: 'Details' },
		{ id: 'email', label: 'Email' },
		{ id: 'documents', label: 'Documents' },
		{ id: 'money', label: 'Money' }
	];

	const { Story } = defineMeta({
		title: 'CRM/ProfileTabs',
		component: ProfileTabs,
		tags: ['autodocs'],
		args: {
			tabs,
			value: 'details'
		}
	});
</script>

<Story name="Default">
	{#snippet template(args)}
		{@const props = /** @type {import('$lib/components/crm/profile-tabs.svelte').ProfileTabsProps} */ (args)}
		<div class="bg-background max-w-2xl p-4">
			<ProfileTabs {...props}>
				{#snippet children({ active })}
					<p class="text-muted-foreground text-sm">
						Active tab: <span class="text-foreground font-medium">{active}</span>
					</p>
				{/snippet}
			</ProfileTabs>
		</div>
	{/snippet}
</Story>

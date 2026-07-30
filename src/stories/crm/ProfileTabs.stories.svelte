<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ProfileTabs from '$lib/components/crm/profile-tabs.svelte';

	const { Story } = defineMeta({
		title: 'CRM/ProfileTabs',
		component: ProfileTabs,
		tags: ['autodocs']
	});

	const tabs = [
		{ id: 'details', label: 'Details' },
		{ id: 'email', label: 'Email' },
		{ id: 'documents', label: 'Documents' },
		{ id: 'money', label: 'Money' }
	];
</script>

<script lang="ts">
	let value = $state('details');
</script>

<div class="bg-background max-w-2xl p-4">
	<Story name="Default" args={{ tabs }}>
		<ProfileTabs {tabs} bind:value>
			{#snippet children({ active }: { active: string })}
				<p class="text-muted-foreground text-sm">
					Active tab: <span class="text-foreground font-medium">{active}</span>
				</p>
			{/snippet}
		</ProfileTabs>
	</Story>
</div>

<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import SettingsConfigPageStoryHost from '$lib/components/crm/settings-config-page.story-host.svelte';
	import { navGroupsWithActive } from './story-fixtures.js';

	const configuration = {
		id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
		version: 2,
		name: 'Corrin Data',
		slug: 'corrin-data',
		timezone: 'Europe/London',
		default_currency: 'GBP',
		locale: 'en-GB',
		country_code: 'GB',
		theme_default: 'system'
	};

	const taxRates = [
		{
			id: 'tax-1',
			version: 1,
			name: 'VAT 20%',
			rate_percent: 20,
			is_default: true,
			active: true
		},
		{
			id: 'tax-2',
			version: 1,
			name: 'Zero rated',
			rate_percent: 0,
			is_default: false,
			active: true
		}
	];

	const { Story } = defineMeta({
		title: 'Headquarters/Pages/SettingsConfig',
		component: SettingsConfigPageStoryHost,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' },
		args: {
			orgName: 'Corrin Data',
			navGroups: navGroupsWithActive('Config'),
			role: 'owner',
			configuration,
			taxRates
		}
	});
</script>

<Story name="Default">
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/settings-config-page.story-host.svelte').SettingsConfigPageStoryHostProps} */ (
				args
			)}
		<div class="h-screen">
			<SettingsConfigPageStoryHost {...props} />
		</div>
	{/snippet}
</Story>

<Story name="Admin" args={{ role: 'admin' }}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/settings-config-page.story-host.svelte').SettingsConfigPageStoryHostProps} */ (
				args
			)}
		<div class="h-screen">
			<SettingsConfigPageStoryHost {...props} />
		</div>
	{/snippet}
</Story>

<Story name="ReadOnly" args={{ role: 'readonly' }}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/settings-config-page.story-host.svelte').SettingsConfigPageStoryHostProps} */ (
				args
			)}
		<div class="h-screen">
			<SettingsConfigPageStoryHost {...props} />
		</div>
	{/snippet}
</Story>

<Story name="EmptyTaxRates" args={{ taxRates: [] }}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/settings-config-page.story-host.svelte').SettingsConfigPageStoryHostProps} */ (
				args
			)}
		<div class="h-screen">
			<SettingsConfigPageStoryHost {...props} />
		</div>
	{/snippet}
</Story>

<Story name="Loading" args={{ viewState: { kind: 'loading' } }}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/settings-config-page.story-host.svelte').SettingsConfigPageStoryHostProps} */ (
				args
			)}
		<div class="h-screen">
			<SettingsConfigPageStoryHost {...props} />
		</div>
	{/snippet}
</Story>

<Story name="Forbidden" args={{ viewState: { kind: 'forbidden', message: 'Membership suspended' } }}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/settings-config-page.story-host.svelte').SettingsConfigPageStoryHostProps} */ (
				args
			)}
		<div class="h-screen">
			<SettingsConfigPageStoryHost {...props} />
		</div>
	{/snippet}
</Story>

<Story
	name="Conflict412"
	args={{
		viewState: {
			kind: 'conflict',
			message: 'Organisation version does not match If-Match'
		}
	}}
>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/settings-config-page.story-host.svelte').SettingsConfigPageStoryHostProps} */ (
				args
			)}
		<div class="h-screen">
			<SettingsConfigPageStoryHost {...props} />
		</div>
	{/snippet}
</Story>

<Story
	name="Validation422"
	args={{
		viewState: {
			kind: 'validation',
			message: 'Invalid configuration',
			fields: { timezone: 'Not/A_Zone is not a valid IANA timezone' }
		}
	}}
>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/settings-config-page.story-host.svelte').SettingsConfigPageStoryHostProps} */ (
				args
			)}
		<div class="h-screen">
			<SettingsConfigPageStoryHost {...props} />
		</div>
	{/snippet}
</Story>

<Story name="Dark" parameters={{ themes: { themeOverride: 'dark' } }}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/settings-config-page.story-host.svelte').SettingsConfigPageStoryHostProps} */ (
				args
			)}
		<div class="h-screen">
			<SettingsConfigPageStoryHost {...props} />
		</div>
	{/snippet}
</Story>

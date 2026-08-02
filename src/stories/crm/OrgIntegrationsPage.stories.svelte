<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import OrgIntegrationsPage from '$lib/components/crm/org-integrations-page.svelte';
	import { navGroupsWithActive } from './story-fixtures.js';

	const disconnected = [
		{
			provider: 'openai',
			credentials_configured: false,
			status: 'disconnected',
			last_verified_at: null,
			last_error_code: null
		},
		{
			provider: 'anthropic',
			credentials_configured: false,
			status: 'disconnected',
			last_verified_at: null,
			last_error_code: null
		},
		{
			provider: 'google',
			credentials_configured: false,
			status: 'disconnected',
			last_verified_at: null,
			last_error_code: null
		},
		{
			provider: 'openrouter',
			credentials_configured: false,
			status: 'disconnected',
			last_verified_at: null,
			last_error_code: null
		}
	];

	const mixed = [
		{
			provider: 'openai',
			credentials_configured: true,
			status: 'connected',
			last_verified_at: '2026-08-02T12:00:00Z',
			last_error_code: null
		},
		{
			provider: 'anthropic',
			credentials_configured: false,
			status: 'disconnected',
			last_verified_at: null,
			last_error_code: null
		},
		{
			provider: 'google',
			credentials_configured: true,
			status: 'error',
			last_verified_at: null,
			last_error_code: 'invalid_api_key'
		},
		{
			provider: 'openrouter',
			credentials_configured: true,
			status: 'connected',
			last_verified_at: '2026-08-01T09:00:00Z',
			last_error_code: null
		}
	];

	const { Story } = defineMeta({
		title: 'Headquarters/Pages/OrgIntegrations',
		component: OrgIntegrationsPage,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' },
		args: {
			orgName: 'Corrin Data',
			navGroups: navGroupsWithActive('Integrations'),
			role: 'owner',
			integrations: disconnected
		}
	});
</script>

<Story name="AllDisconnected">
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/org-integrations-page.svelte').OrgIntegrationsPageProps} */ (
				args
			)}
		<div class="bg-background h-screen">
			<OrgIntegrationsPage {...props} />
		</div>
	{/snippet}
</Story>

<Story name="MixedStatus" args={{ integrations: mixed }}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/org-integrations-page.svelte').OrgIntegrationsPageProps} */ (
				args
			)}
		<div class="bg-background h-screen">
			<OrgIntegrationsPage {...props} />
		</div>
	{/snippet}
</Story>

<Story name="MemberReadonly" args={{ role: 'member', integrations: mixed }}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/org-integrations-page.svelte').OrgIntegrationsPageProps} */ (
				args
			)}
		<div class="bg-background h-screen">
			<OrgIntegrationsPage {...props} />
		</div>
	{/snippet}
</Story>

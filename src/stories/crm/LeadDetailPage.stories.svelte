<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import LeadDetailPageStoryHost from '$lib/components/crm/lead-detail-page.story-host.svelte';
	import type { LeadResource } from '$lib/schemas/lead.js';
	import { navGroupsWithActive } from './story-fixtures.js';

	const openLead = {
		id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
		version: 3,
		name: 'Contoso expansion',
		company_name: 'Contoso',
		stage: 'proposal',
		value_cents: 1_800_000,
		currency: 'GBP',
		probability_percent: 60,
		source: 'Referral',
		expected_close_on: '2026-08-15',
		notes: 'Needs MSA review'
	} satisfies LeadResource;

	const wonLead = {
		...openLead,
		stage: 'won',
		version: 5,
		client_id: '11111111-2222-4333-8444-555555555555',
		won_at: '2026-07-30T12:00:00Z',
		converted_at: '2026-07-30T12:00:00Z'
	} satisfies LeadResource;

	const { Story } = defineMeta({
		title: 'Headquarters/Pages/LeadDetail',
		component: LeadDetailPageStoryHost,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' },
		args: {
			orgName: 'Acme Org',
			navGroups: navGroupsWithActive('Leads'),
			lead: openLead
		}
	});
</script>

<script lang="ts">
	import type { LeadConvertResult } from '$lib/components/crm/lead-detail-page.svelte';
	import type { LeadResource as LeadResourceType } from '$lib/schemas/lead.js';

	let converting = $state(false);
	let lastConvertResult = $state<LeadConvertResult | null>(null);
	let lead = $state<LeadResourceType>({ ...openLead });

	async function runConvert() {
		converting = true;
		await new Promise((r) => setTimeout(r, 400));
		lead = { ...wonLead };
		lastConvertResult = {
			lead: wonLead,
			client: {
				id: wonLead.client_id!,
				version: 1,
				name: 'Contoso',
				status: 'active'
			},
			idempotent: false
		};
		converting = false;
	}
</script>

<Story name="Default">
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/lead-detail-page.story-host.svelte').LeadDetailPageStoryHostProps} */ (
				args
			)}
		<div class="h-screen">
			<LeadDetailPageStoryHost {...props} />
		</div>
	{/snippet}
</Story>

<Story name="ConvertFlow">
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/lead-detail-page.story-host.svelte').LeadDetailPageStoryHostProps} */ (
				args
			)}
		<div class="h-screen">
			<LeadDetailPageStoryHost
				{...props}
				{lead}
				{converting}
				{lastConvertResult}
				onConvert={runConvert}
			/>
		</div>
	{/snippet}
</Story>

<Story
	name="Converted"
	args={{
		lead: wonLead,
		lastConvertResult: {
			lead: wonLead,
			client: {
				id: wonLead.client_id,
				version: 1,
				name: 'Contoso',
				status: 'active'
			},
			idempotent: true
		}
	}}
>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/lead-detail-page.story-host.svelte').LeadDetailPageStoryHostProps} */ (
				args
			)}
		<div class="h-screen">
			<LeadDetailPageStoryHost {...props} />
		</div>
	{/snippet}
</Story>

<Story
	name="NotFound"
	args={{ lead: null, viewState: { kind: 'not_found', message: 'Lead not found' } }}
>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/lead-detail-page.story-host.svelte').LeadDetailPageStoryHostProps} */ (
				args
			)}
		<div class="h-screen">
			<LeadDetailPageStoryHost {...props} />
		</div>
	{/snippet}
</Story>

<Story
	name="Conflict412"
	args={{
		viewState: {
			kind: 'conflict',
			message: 'Lead version does not match If-Match'
		}
	}}
>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/lead-detail-page.story-host.svelte').LeadDetailPageStoryHostProps} */ (
				args
			)}
		<div class="h-screen">
			<LeadDetailPageStoryHost {...props} />
		</div>
	{/snippet}
</Story>

<Story
	name="Validation422"
	args={{
		viewState: {
			kind: 'validation',
			fields: { value_cents: 'Must be a non-negative safe integer or null' }
		}
	}}
>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/lead-detail-page.story-host.svelte').LeadDetailPageStoryHostProps} */ (
				args
			)}
		<div class="h-screen">
			<LeadDetailPageStoryHost {...props} />
		</div>
	{/snippet}
</Story>

<Story name="ResponsiveNarrow">
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/lead-detail-page.story-host.svelte').LeadDetailPageStoryHostProps} */ (
				args
			)}
		<div class="mx-auto h-screen max-w-md border">
			<LeadDetailPageStoryHost {...props} />
		</div>
	{/snippet}
</Story>

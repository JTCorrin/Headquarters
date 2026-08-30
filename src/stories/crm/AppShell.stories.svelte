<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import AppShell from '$lib/components/crm/app-shell.svelte';
	import { navGroupsWithActive, storyViewport } from './story-fixtures.js';
	import type { OrgMembershipSummary } from '$lib/schemas/organisation.js';

	const acme = {
		org_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
		org_name: 'Acme Org',
		org_slug: 'acme',
		role: 'owner',
		theme_default: 'system'
	} satisfies OrgMembershipSummary;

	const { Story } = defineMeta({
		title: 'Headquarters/Chrome/AppShell',
		component: AppShell,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' },
		args: {
			currentOrgId: acme.org_id,
			memberships: [acme],
			orgName: 'Acme Org',
			navGroups: navGroupsWithActive('Dashboard')
		}
	});

	async function playOpenMobileNav({
		canvas,
		userEvent
	}: {
		canvas: { getByTestId: (id: string) => HTMLElement };
		userEvent: { click: (el: HTMLElement) => Promise<void> };
	}) {
		await userEvent.click(canvas.getByTestId('app-sidebar-trigger'));
	}
</script>

<Story name="Desktop" globals={storyViewport.desktop}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/app-shell.svelte').AppShellProps} */ (args)}
		<AppShell {...props}>
			<div class="space-y-3 p-6">
				<p class="text-lg font-semibold tracking-tight">Dashboard</p>
				<p class="text-muted-foreground text-sm">
					Placeholder content so the mobile nav sheet can overlay the page.
				</p>
			</div>
		</AppShell>
	{/snippet}
</Story>

<Story name="Tablet" globals={storyViewport.tablet}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/app-shell.svelte').AppShellProps} */ (args)}
		<AppShell {...props}>
			<div class="space-y-3 p-6">
				<p class="text-lg font-semibold tracking-tight">Dashboard</p>
				<p class="text-muted-foreground text-sm">
					Placeholder content so the mobile nav sheet can overlay the page.
				</p>
			</div>
		</AppShell>
	{/snippet}
</Story>

<Story name="Mobile" globals={storyViewport.mobile}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/app-shell.svelte').AppShellProps} */ (args)}
		<AppShell {...props}>
			<div class="space-y-3 p-6">
				<p class="text-lg font-semibold tracking-tight">Dashboard</p>
				<p class="text-muted-foreground text-sm">
					Tap the sidebar trigger to open navigation.
				</p>
			</div>
		</AppShell>
	{/snippet}
</Story>

<Story name="Mobile open" globals={storyViewport.mobile} play={playOpenMobileNav}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/app-shell.svelte').AppShellProps} */ (args)}
		<AppShell {...props}>
			<div class="space-y-3 p-6">
				<p class="text-lg font-semibold tracking-tight">Dashboard</p>
				<p class="text-muted-foreground text-sm">
					The mobile nav sheet starts open over this content.
				</p>
			</div>
		</AppShell>
	{/snippet}
</Story>

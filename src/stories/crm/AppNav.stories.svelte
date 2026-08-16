<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import AppNav from '$lib/components/crm/app-nav.svelte';
	import AppSidebarFrame from '$lib/components/crm/app-sidebar-frame.svelte';
	import { storyViewport } from './story-fixtures.js';

	const groups = [
		{
			items: [
				{ label: 'Dashboard', href: '/', active: true },
				{ label: 'Contacts', href: '/contacts' },
				{ label: 'Leads', href: '/leads' },
				{ label: 'Clients', href: '/clients' }
			]
		},
		{
			label: 'Work',
			items: [
				{ label: 'Tasks', href: '/tasks' },
				{ label: 'Meetings', href: '/meetings' },
				{ label: 'Projects', href: '/projects' }
			]
		},
		{
			label: 'Accounting',
			items: [
				{ label: 'Quotes', href: '/quotes' },
				{ label: 'Invoices', href: '/invoices' },
				{ label: 'Bills', href: '/bills' },
				{ label: 'Payments', href: '/payments' }
			]
		},
		{
			label: 'Comms',
			items: [
				{ label: 'Email', href: '/email' },
				{ label: 'Templates', href: '/email/templates' },
				{ label: 'Playbooks', href: '/playbooks' },
				{ label: 'Documents', href: '/documents' }
			]
		}
	];

	const { Story } = defineMeta({
		title: 'Headquarters/AppNav',
		component: AppNav,
		tags: ['autodocs'],
		parameters: {
			layout: 'fullscreen'
		},
		args: {
			orgName: 'Acme Org',
			groups
		}
	});
</script>

<Story name="Default">
	{#snippet template(args)}
		{@const props = /** @type {import('$lib/components/crm/app-nav.svelte').AppNavProps} */ (args)}
		<div class="bg-background h-[720px]">
			<AppSidebarFrame
				orgName={props.orgName}
				groups={props.groups}
				showNav
				showTrigger
				class="h-full"
			>
				<div class="p-6">
					<p class="text-lg font-semibold tracking-tight">Page</p>
					<p class="text-muted-foreground text-sm">Content beside the navigation.</p>
				</div>
			</AppSidebarFrame>
		</div>
	{/snippet}
</Story>

<Story name="Mobile" globals={storyViewport.mobile}>
	{#snippet template(args)}
		{@const props = /** @type {import('$lib/components/crm/app-nav.svelte').AppNavProps} */ (args)}
		<div class="bg-background h-screen">
			<AppSidebarFrame
				orgName={props.orgName}
				groups={props.groups}
				showNav
				showTrigger
				class="h-full"
			>
				<div class="p-6">
					<p class="text-lg font-semibold tracking-tight">Page</p>
					<p class="text-muted-foreground text-sm">Tap the sidebar trigger to open navigation.</p>
				</div>
			</AppSidebarFrame>
		</div>
	{/snippet}
</Story>

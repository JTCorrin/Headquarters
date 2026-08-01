<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { ContactFormData } from '$lib/schemas/contact.js';
	import type { LeadClientOption } from '$lib/schemas/lead.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import ContactsTable from './contacts-table.svelte';
	import type { ContactRow } from './contacts-columns.js';
	import ContactFormDrawer from './contact-form-drawer.svelte';
	import { cn } from '$lib/utils.js';

	export interface ContactsListPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		rows: ContactRow[];
		form: SuperForm<ContactFormData>;
		clientOptions?: LeadClientOption[];
		drawerOpen?: boolean;
		/** When false, omit AppNav (shell already renders it at full window height). */
		showNav?: boolean;
		class?: string;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
		onCreateClient?: () => void;
	}

	let {
		orgName,
		navGroups,
		rows,
		form,
		clientOptions = [],
		drawerOpen = $bindable(false),
		showNav = true,
		class: className,
		onValidSubmit,
		onCreateClient
	}: ContactsListPageProps = $props();
</script>

<div
	class={cn(
		'bg-background text-foreground flex',
		showNav ? 'h-full min-h-svh' : 'min-h-0 flex-1 flex-col',
		className
	)}
>
	{#if showNav}
		<AppNav {orgName} groups={navGroups} class="h-full shrink-0 self-stretch" />
	{/if}

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-6 py-6 md:px-8">
			<PageHeader
				breadcrumb="Headquarters"
				title="Contacts"
				description="People and companies in your pipeline."
			>
				{#snippet actions()}
					<ContactFormDrawer
						bind:open={drawerOpen}
						{form}
						{clientOptions}
						{onValidSubmit}
						{onCreateClient}
						triggerLabel="New contact"
					/>
				{/snippet}
			</PageHeader>

			<ContactsTable {rows} />
		</div>
	</main>
</div>

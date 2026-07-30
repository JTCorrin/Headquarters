<script lang="ts">
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import ClientsTable from './clients-table.svelte';
	import type { ClientRow } from './clients-columns.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface ClientsListPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		rows: ClientRow[];
		class?: string;
	}

	let { orgName, navGroups, rows, class: className }: ClientsListPageProps = $props();
</script>

<div class={cn('bg-background text-foreground flex h-full min-h-[720px]', className)}>
	<AppNav {orgName} groups={navGroups} class="shrink-0" />

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-6 py-6 md:px-8">
			<PageHeader
				breadcrumb="CRM"
				title="Clients"
				description="Won accounts — money, contacts, and activity live on the profile."
			>
				{#snippet actions()}
					<Button type="button" variant="outline" size="sm">Import</Button>
					<Button type="button" size="sm">New client</Button>
				{/snippet}
			</PageHeader>

			<ClientsTable {rows} />
		</div>
	</main>
</div>

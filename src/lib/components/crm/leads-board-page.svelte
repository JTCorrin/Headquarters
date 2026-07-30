<script lang="ts">
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import LeadsBoard, { type LeadCard } from './leads-board.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface LeadsBoardPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		leads: LeadCard[];
		class?: string;
	}

	let { orgName, navGroups, leads, class: className }: LeadsBoardPageProps = $props();
</script>

<div class={cn('bg-background text-foreground flex h-full min-h-[720px]', className)}>
	<AppNav {orgName} groups={navGroups} class="shrink-0" />

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-6 py-6 md:px-8">
			<PageHeader
				breadcrumb="CRM"
				title="Leads"
				description="Pipeline board — drag cards between stages (SVAR Kanban)."
			>
				{#snippet actions()}
					<Button variant="outline" size="sm">Table view</Button>
					<Button size="sm">New lead</Button>
				{/snippet}
			</PageHeader>

			<LeadsBoard {leads} class="min-h-[480px]" />
		</div>
	</main>
</div>

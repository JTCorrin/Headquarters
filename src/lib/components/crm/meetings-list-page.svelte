<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { MeetingFormData } from '$lib/schemas/meeting.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import MeetingsTable from './meetings-table.svelte';
	import type { MeetingRow } from './meetings-columns.js';
	import MeetingFormDrawer from './meeting-form-drawer.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface MeetingsListPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		rows: MeetingRow[];
		form: SuperForm<MeetingFormData>;
		drawerOpen?: boolean;
		class?: string;
	}

	let {
		orgName,
		navGroups,
		rows,
		form,
		drawerOpen = $bindable(false),
		class: className
	}: MeetingsListPageProps = $props();
</script>

<div class={cn('bg-background text-foreground flex h-full min-h-[720px]', className)}>
	<AppNav {orgName} groups={navGroups} class="shrink-0" />

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-6 py-6 md:px-8">
			<PageHeader
				breadcrumb="Work"
				title="Meetings"
				description="Upcoming and past — transcripts and AI summaries live on each meeting."
			>
				{#snippet actions()}
					<MeetingFormDrawer bind:open={drawerOpen} {form}>
						{#snippet trigger()}
							<Button type="button" size="sm">New meeting</Button>
						{/snippet}
					</MeetingFormDrawer>
				{/snippet}
			</PageHeader>

			<MeetingsTable {rows} />
		</div>
	</main>
</div>

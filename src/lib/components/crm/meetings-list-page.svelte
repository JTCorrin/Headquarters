<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import type { MeetingFormData, MeetingListItem } from '$lib/schemas/meeting.js';
	import { type AppNavGroup } from './app-nav.svelte';
	import AppSidebarFrame from './app-sidebar-frame.svelte';
	import PageHeader from './page-header.svelte';
	import MeetingsTable from './meetings-table.svelte';
	import MeetingFormDrawer from './meeting-form-drawer.svelte';
	import ListFilterBanner from './list-filter-banner.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface MeetingsListPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		rows: MeetingListItem[];
		form: SuperForm<MeetingFormData>;
		api?: ApiV1Client | null;
		drawerOpen?: boolean;
		editForm?: SuperForm<MeetingFormData>;
		editDrawerOpen?: boolean;
		filterLabel?: string | null;
		onClearFilter?: () => void;
		/** When false, omit AppNav (shell already renders it at full window height). */
		showNav?: boolean;
		class?: string;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
		onValidEdit?: () => boolean | void | Promise<boolean | void>;
		onEditMeeting?: (id: string) => void;
		onDeleteMeeting?: (id: string) => void;
		onOpenCalendar?: () => void;
	}

	let {
		orgName,
		navGroups,
		rows,
		form,
		api = null,
		drawerOpen = $bindable(false),
		editForm,
		editDrawerOpen = $bindable(false),
		filterLabel = null,
		onClearFilter,
		showNav = true,
		class: className,
		onValidSubmit,
		onValidEdit,
		onEditMeeting,
		onDeleteMeeting,
		onOpenCalendar
	}: MeetingsListPageProps = $props();
</script>

<AppSidebarFrame
	{orgName}
	groups={navGroups}
	{showNav}
	showTrigger={showNav}
	class={cn(
		showNav ? 'h-full min-h-svh' : 'min-h-0 flex-1 flex-col',
		className
	)}
>

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-4 py-6 sm:px-6 md:px-8">
			<PageHeader title="Meetings">
				{#snippet actions()}
					{#if onOpenCalendar}
						<Button type="button" size="sm" variant="outline" onclick={onOpenCalendar}>
							Calendar
						</Button>
					{/if}
					<MeetingFormDrawer bind:open={drawerOpen} {form} {api} {onValidSubmit} />
				{/snippet}
			</PageHeader>

			{#if filterLabel}
				<ListFilterBanner label={filterLabel} onClear={onClearFilter} />
			{/if}

			<MeetingsTable {rows} {onEditMeeting} {onDeleteMeeting} />
		</div>
	</main>
</AppSidebarFrame>

{#if editForm}
	<MeetingFormDrawer
		bind:open={editDrawerOpen}
		form={editForm}
		{api}
		showTrigger={false}
		title="Edit meeting"
		description="Update schedule, related record, or attendees. Changes use If-Match versioning."
		submitLabel="Save changes"
		onValidSubmit={onValidEdit}
	/>
{/if}

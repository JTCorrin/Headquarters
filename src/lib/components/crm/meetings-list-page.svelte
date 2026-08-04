<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { MeetingFormData, MeetingListItem } from '$lib/schemas/meeting.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import MeetingsTable from './meetings-table.svelte';
	import MeetingFormDrawer from './meeting-form-drawer.svelte';
	import ListFilterBanner from './list-filter-banner.svelte';
	import { cn } from '$lib/utils.js';

	export interface MeetingsListPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		rows: MeetingListItem[];
		form: SuperForm<MeetingFormData>;
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
	}

	let {
		orgName,
		navGroups,
		rows,
		form,
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
		onDeleteMeeting
	}: MeetingsListPageProps = $props();
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
				breadcrumb="Work"
				title="Meetings"
				description="Upcoming and past — transcripts and AI summaries live on each meeting."
			>
				{#snippet actions()}
					<MeetingFormDrawer bind:open={drawerOpen} {form} {onValidSubmit} />
				{/snippet}
			</PageHeader>

			{#if filterLabel}
				<ListFilterBanner label={filterLabel} onClear={onClearFilter} />
			{/if}

			<MeetingsTable {rows} {onEditMeeting} {onDeleteMeeting} />
		</div>
	</main>
</div>

{#if editForm}
	<MeetingFormDrawer
		bind:open={editDrawerOpen}
		form={editForm}
		showTrigger={false}
		title="Edit meeting"
		description="Update schedule, related record, or attendees. Changes use If-Match versioning."
		submitLabel="Save changes"
		onValidSubmit={onValidEdit}
	/>
{/if}

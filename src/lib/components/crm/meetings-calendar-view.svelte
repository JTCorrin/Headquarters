<script lang="ts">
	import type { CalendarDate } from '@internationalized/date';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import type { MeetingFormData, MeetingListItem } from '$lib/schemas/meeting.js';
	import { calendarMonthLabel } from '$lib/crm/meeting-calendar-range.js';
	import type { AppNavGroup } from './app-nav.svelte';
	import AppNav from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import MeetingFormDrawer from './meeting-form-drawer.svelte';
	import MeetingsCalendarGrid from './meetings-calendar-grid.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface MeetingsCalendarViewProps {
		orgName: string;
		navGroups: AppNavGroup[];
		month: CalendarDate;
		days: CalendarDate[];
		meetings: MeetingListItem[];
		form: SuperForm<MeetingFormData>;
		api?: ApiV1Client | null;
		drawerOpen?: boolean;
		showNav?: boolean;
		class?: string;
		onPrevMonth?: () => void;
		onNextMonth?: () => void;
		onSelectDay?: (day: CalendarDate) => void;
		onSelectMeeting?: (meetingId: string) => void;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
		onOpenList?: () => void;
	}

	let {
		orgName,
		navGroups,
		month,
		days,
		meetings,
		form,
		api = null,
		drawerOpen = $bindable(false),
		showNav = true,
		class: className,
		onPrevMonth,
		onNextMonth,
		onSelectDay,
		onSelectMeeting,
		onValidSubmit,
		onOpenList
	}: MeetingsCalendarViewProps = $props();
</script>

<div
	class={cn(
		'bg-background text-foreground flex',
		showNav ? 'h-full min-h-svh' : 'min-h-0 flex-1 flex-col',
		className
	)}
	data-testid="meetings-calendar-view"
>
	{#if showNav}
		<AppNav {orgName} groups={navGroups} class="h-full shrink-0 self-stretch" />
	{/if}

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-6 py-6 md:px-8">
			<PageHeader title="Calendar">
				{#snippet actions()}
					{#if onOpenList}
						<Button type="button" size="sm" variant="outline" onclick={onOpenList}>
							List
						</Button>
					{/if}
					<MeetingFormDrawer bind:open={drawerOpen} {form} {api} {onValidSubmit} />
				{/snippet}
			</PageHeader>

			<div class="flex flex-wrap items-center justify-between gap-3">
				<div class="flex items-center gap-2">
					<Button
						type="button"
						size="sm"
						variant="outline"
						aria-label="Previous month"
						data-testid="calendar-prev-month"
						onclick={() => onPrevMonth?.()}
					>
						Prev
					</Button>
					<Button
						type="button"
						size="sm"
						variant="outline"
						aria-label="Next month"
						data-testid="calendar-next-month"
						onclick={() => onNextMonth?.()}
					>
						Next
					</Button>
				</div>
				<p class="text-sm font-medium" data-testid="calendar-month-label">
					{calendarMonthLabel(month)}
				</p>
			</div>

			<MeetingsCalendarGrid
				{month}
				{days}
				{meetings}
				{onSelectDay}
				{onSelectMeeting}
			/>
		</div>
	</main>
</div>

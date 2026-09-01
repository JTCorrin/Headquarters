<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import MeetingsListPage from '$lib/components/crm/meetings-list-page.svelte';
	import type { MeetingListItem } from '$lib/schemas/meeting.js';
	import { navGroupsWithActive } from './story-fixtures.js';

	const rows = [
		{
			id: '1',
			title: 'Q2 planning',
			when: 'Today · 15:00',
			withWhom: 'Ava Chen',
			relatedTo: 'Northwind',
			status: 'Scheduled',
			version: 1,
			rawStatus: 'scheduled',
			startsAt: '2026-08-03T15:00:00.000Z',
			endsAt: '2026-08-03T15:45:00.000Z',
			timezone: 'UTC',
			calendarProvider: 'google',
			externalEventId: 'evt-1'
		},
		{
			id: '2',
			title: 'Renewal check-in',
			when: 'Thu · 11:30',
			withWhom: 'Sam Ortiz',
			relatedTo: 'Contoso',
			status: 'Scheduled',
			version: 1,
			rawStatus: 'scheduled',
			startsAt: '2026-08-06T11:30:00.000Z',
			endsAt: '2026-08-06T12:00:00.000Z',
			timezone: 'UTC',
			calendarProvider: null,
			externalEventId: null
		},
		{
			id: '3',
			title: 'Kickoff dry-run',
			when: 'Fri · 09:00',
			withWhom: 'Internal',
			relatedTo: 'Northwind',
			status: 'Scheduled',
			version: 1,
			rawStatus: 'scheduled',
			startsAt: '2026-08-07T09:00:00.000Z',
			endsAt: '2026-08-07T09:30:00.000Z',
			timezone: 'UTC',
			calendarProvider: null,
			externalEventId: null
		},
		{
			id: '4',
			title: 'Discovery call',
			when: 'Mar 12 · 10:00',
			withWhom: 'Riley Park',
			relatedTo: 'Litware',
			status: 'Completed',
			version: 1,
			rawStatus: 'completed',
			startsAt: '2026-03-12T10:00:00.000Z',
			endsAt: '2026-03-12T10:45:00.000Z',
			timezone: 'UTC',
			calendarProvider: null,
			externalEventId: null
		}
	] satisfies MeetingListItem[];

	const { Story } = defineMeta({
		title: 'Headquarters/Pages/MeetingsList',
		component: MeetingsListPage,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' },
		args: {
			orgName: 'Acme Org',
			navGroups: navGroupsWithActive('Meetings'),
			rows
		}
	});
</script>

<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { emptyMeetingFormData } from '$lib/api/v1/mappers.js';
	import { meetingFormSchema } from '$lib/schemas/meeting.js';

	const form = superForm(defaults(emptyMeetingFormData(), zod4(meetingFormSchema)), {
		validators: zod4(meetingFormSchema),
		SPA: true,
		warnings: { duplicateId: false },
		resetForm: false
	});
</script>

<Story name="Default">
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/meetings-list-page.svelte').MeetingsListPageProps} */ (
				args
			)}
		<div class="h-screen">
			<MeetingsListPage {...props} {form} />
		</div>
	{/snippet}
</Story>

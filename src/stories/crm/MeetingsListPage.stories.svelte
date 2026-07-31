<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import MeetingsListPage from '$lib/components/crm/meetings-list-page.svelte';
	import { navGroupsWithActive } from './story-fixtures.js';

	const rows = [
		{
			id: '1',
			title: 'Q2 planning',
			when: 'Today · 15:00',
			withWhom: 'Ava Chen',
			relatedTo: 'Northwind',
			status: 'Scheduled'
		},
		{
			id: '2',
			title: 'Renewal check-in',
			when: 'Thu · 11:30',
			withWhom: 'Sam Ortiz',
			relatedTo: 'Contoso',
			status: 'Scheduled'
		},
		{
			id: '3',
			title: 'Kickoff dry-run',
			when: 'Fri · 09:00',
			withWhom: 'Internal',
			relatedTo: 'Northwind',
			status: 'Scheduled'
		},
		{
			id: '4',
			title: 'Discovery call',
			when: 'Mar 12 · 10:00',
			withWhom: 'Riley Park',
			relatedTo: 'Litware',
			status: 'Completed'
		}
	];

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
	import { meetingFormSchema } from '$lib/schemas/meeting.js';

	const data = defaults(
		{
			title: '',
			relatedTo: '',
			startsAt: '',
			endsAt: '',
			attendees: '',
			status: 'scheduled'
		},
		zod4(meetingFormSchema)
	);

	const form = superForm(data, {
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

<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import MeetingWorkspacePage from '$lib/components/crm/meeting-workspace-page.svelte';
	import { navGroupsWithActive } from './story-fixtures.js';

	const { Story } = defineMeta({
		title: 'Headquarters/Pages/MeetingWorkspace',
		component: MeetingWorkspacePage,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' }
	});
</script>

<script lang="ts">
	import type { ProposedMeetingTask } from '$lib/components/crm/meeting-workspace-page.svelte';

	let transcript = $state('');
	let summary = $state('');
	let proposedTasks = $state<ProposedMeetingTask[]>([]);

	const sampleTranscript = `Joe: Thanks for joining — shall we walk the Q2 retainer scope?
Ava: Yes. We want the kickoff moved to Thursday if possible.
Joe: Noted. I'll send a revised pack and chase the open quote.
Ava: Perfect. Also can we get a task for billing contact setup?`;

	const sampleSummary = `Discussed Q2 retainer kickoff timing and open quote Q-0142.
Agreed to move kickoff to Thursday morning.
Billing contact still needs to be set up on the Northwind account.`;

	function uploadTranscript() {
		transcript = sampleTranscript;
	}

	function generateSummary() {
		if (!transcript) transcript = sampleTranscript;
		summary = sampleSummary;
		proposedTasks = [
			{
				id: 't1',
				title: 'Send revised kickoff pack',
				assignee: 'Joe'
			},
			{
				id: 't2',
				title: 'Chase quote Q-0142',
				assignee: 'Joe'
			},
			{
				id: 't3',
				title: 'Add Northwind billing contact',
				assignee: 'Maya'
			}
		];
	}

	function acceptTask(id: string) {
		proposedTasks = proposedTasks.map((t) => (t.id === id ? { ...t, accepted: true } : t));
	}

	function acceptAll() {
		proposedTasks = proposedTasks.map((t) => ({ ...t, accepted: true }));
	}
</script>

<Story name="Default">
	{#snippet template()}
		<div class="h-screen">
			<MeetingWorkspacePage
				orgName="Acme Org"
				navGroups={navGroupsWithActive('Meetings')}
				title="Q2 planning"
				status="Scheduled"
				when="Today · 15:00–15:45"
				relatedTo="Northwind"
				scheduleFields={[
					{ label: 'When', value: 'Today · 15:00–15:45' },
					{ label: 'Timezone', value: 'Europe/London' },
					{ label: 'Location', value: 'Boardroom' },
					{ label: 'Related', value: 'Northwind' }
				]}
				attendeeFields={[
					{ label: 'Primary', value: 'Ava Chen · ava@northwind.com' },
					{ label: 'Internal', value: 'Joe' },
					{ label: 'Client', value: 'Northwind' }
				]}
				{transcript}
				{summary}
				bind:proposedTasks
				onUploadTranscript={uploadTranscript}
				onGenerateSummary={generateSummary}
				onAcceptTask={acceptTask}
				onAcceptAllTasks={acceptAll}
			/>
		</div>
	{/snippet}
</Story>

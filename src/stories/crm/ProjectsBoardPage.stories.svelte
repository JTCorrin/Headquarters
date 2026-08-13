<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ProjectsBoardPage from '$lib/components/crm/projects-board-page.svelte';

	const { Story } = defineMeta({
		title: 'Headquarters/Pages/ProjectsBoard',
		component: ProjectsBoardPage,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' }
	});

	const clients = [
		{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Northwind' },
		{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Contoso' },
		{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Fabrikam' }
	];

	const projects = [
		{
			id: 'p1',
			name: 'Q2 retainer delivery',
			clientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
			clientName: 'Northwind',
			owner: 'Joe',
			cardCount: 8,
			stage: 'active',
			version: 1,
			position: 0
		},
		{
			id: 'p2',
			name: 'Warehouse rollout',
			clientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
			clientName: 'Northwind',
			owner: 'Maya',
			cardCount: 12,
			stage: 'planning',
			version: 1,
			position: 0
		},
		{
			id: 'p3',
			name: 'Portal integration',
			clientId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
			clientName: 'Fabrikam',
			owner: 'Joe',
			cardCount: 5,
			stage: 'active',
			version: 1,
			position: 1
		},
		{
			id: 'p4',
			name: 'Expansion discovery',
			clientId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
			clientName: 'Contoso',
			owner: 'Maya',
			cardCount: 3,
			stage: 'blocked',
			version: 1,
			position: 0
		},
		{
			id: 'p5',
			name: 'Kickoff pack',
			clientId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
			clientName: 'Contoso',
			owner: 'Joe',
			cardCount: 6,
			stage: 'done',
			version: 1,
			position: 0
		},
		{
			id: 'p6',
			name: 'Ops handbook',
			clientId: 'internal',
			clientName: 'Internal',
			owner: 'Joe',
			cardCount: 4,
			stage: 'planning',
			version: 1,
			position: 1
		}
	];
</script>

<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { projectFormSchema } from '$lib/schemas/project.js';
	import { navGroupsWithActive } from './story-fixtures.js';

	const data = defaults(
		{
			name: '',
			clientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
			description: '',
			status: 'planning'
		},
		zod4(projectFormSchema)
	);

	const form = superForm(data, {
		validators: zod4(projectFormSchema),
		SPA: true,
		warnings: { duplicateId: false },
		resetForm: false
	});
</script>

<Story name="Default">
	{#snippet template()}
		<div class="h-screen">
			<ProjectsBoardPage
				orgName="Acme Org"
				navGroups={navGroupsWithActive('Projects')}
				{projects}
				{clients}
				{form}
			/>
		</div>
	{/snippet}
</Story>

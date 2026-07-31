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
		{ id: 'c-northwind', name: 'Northwind' },
		{ id: 'c-contoso', name: 'Contoso' },
		{ id: 'c-fabrikam', name: 'Fabrikam' }
	];

	const projects = [
		{
			id: 'p1',
			name: 'Q2 retainer delivery',
			clientId: 'c-northwind',
			clientName: 'Northwind',
			owner: 'Joe',
			cardCount: 8,
			stage: 'active'
		},
		{
			id: 'p2',
			name: 'Warehouse rollout',
			clientId: 'c-northwind',
			clientName: 'Northwind',
			owner: 'Maya',
			cardCount: 12,
			stage: 'planning'
		},
		{
			id: 'p3',
			name: 'Pilot integration',
			clientId: 'c-fabrikam',
			clientName: 'Fabrikam',
			owner: 'Joe',
			cardCount: 5,
			stage: 'active'
		},
		{
			id: 'p4',
			name: 'Expansion discovery',
			clientId: 'c-contoso',
			clientName: 'Contoso',
			owner: 'Maya',
			cardCount: 3,
			stage: 'blocked'
		},
		{
			id: 'p5',
			name: 'Kickoff pack',
			clientId: 'c-contoso',
			clientName: 'Contoso',
			owner: 'Joe',
			cardCount: 6,
			stage: 'done'
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
			clientId: 'c-northwind',
			description: '',
			owner: '',
			status: 'planning'
		},
		zod4(projectFormSchema)
	);

	const form = superForm(data, {
		validators: zod4(projectFormSchema),
		SPA: true,
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

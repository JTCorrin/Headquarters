<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import NotesListPage from '$lib/components/crm/notes-list-page.svelte';
	import type { NoteListItem } from '$lib/schemas/note.js';
	import { navGroupsWithActive } from './story-fixtures.js';

	const items = [
		{
			id: '1',
			title: 'Call notes — Acme renewal',
			displayTitle: 'Call notes — Acme renewal',
			excerpt:
				'Spoke with Dana about renewal. They want a 3-year term with a price hold. Follow up Thursday with a revised quote and two reference customers.',
			color: 'blue',
			pinned: true,
			updatedAt: '2026-09-14T09:10:00.000Z',
			updatedLabel: '2 hours ago',
			version: 3
		},
		{
			id: '2',
			title: 'Q4 roadmap ideas',
			displayTitle: 'Q4 roadmap ideas',
			excerpt:
				'Ship notes v1. Revisit tags and entity links after feedback. Consider MCP exposure once the privacy story is clear.',
			color: 'purple',
			pinned: true,
			updatedAt: '2026-09-13T16:00:00.000Z',
			updatedLabel: 'yesterday',
			version: 5
		},
		{
			id: '3',
			title: 'Groceries',
			displayTitle: 'Groceries',
			excerpt: 'Milk, eggs, bread, coffee beans, oat milk, bananas.',
			color: 'yellow',
			pinned: false,
			updatedAt: '2026-09-14T11:40:00.000Z',
			updatedLabel: '20 minutes ago',
			version: 1
		},
		{
			id: '4',
			title: '',
			displayTitle: 'Untitled',
			excerpt: '',
			color: 'gray',
			pinned: false,
			updatedAt: '2026-09-14T11:55:00.000Z',
			updatedLabel: 'just now',
			version: 1
		},
		{
			id: '5',
			title: 'Reading list',
			displayTitle: 'Reading list',
			excerpt:
				'Designing Data-Intensive Applications; The Staff Engineer’s Path; Working in Public; An Elegant Puzzle.',
			color: 'green',
			pinned: false,
			updatedAt: '2026-09-10T08:00:00.000Z',
			updatedLabel: '4 days ago',
			version: 2
		},
		{
			id: '6',
			title: 'Ideas',
			displayTitle: 'Ideas',
			excerpt: 'Sticky notes should feel like paper.',
			color: 'pink',
			pinned: false,
			updatedAt: '2026-09-01T08:00:00.000Z',
			updatedLabel: '2 weeks ago',
			version: 1
		}
	] satisfies NoteListItem[];

	const { Story } = defineMeta({
		title: 'Headquarters/Pages/NotesList',
		component: NotesListPage,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' },
		args: {
			orgName: 'Acme Org',
			navGroups: navGroupsWithActive('Notes'),
			items
		}
	});
</script>

<Story name="Grid" args={{ viewMode: 'grid' }}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/notes-list-page.svelte').NotesListPageProps} */ (args)}
		<div class="h-screen">
			<NotesListPage {...props} />
		</div>
	{/snippet}
</Story>

<Story name="Table" args={{ viewMode: 'table' }}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/notes-list-page.svelte').NotesListPageProps} */ (args)}
		<div class="h-screen">
			<NotesListPage {...props} />
		</div>
	{/snippet}
</Story>

<Story name="Empty" args={{ items: [] }}>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/notes-list-page.svelte').NotesListPageProps} */ (args)}
		<div class="h-screen">
			<NotesListPage {...props} />
		</div>
	{/snippet}
</Story>

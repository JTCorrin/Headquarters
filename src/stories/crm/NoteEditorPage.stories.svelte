<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import NoteEditorPage from '$lib/components/crm/note-editor-page.svelte';
	import { navGroupsWithActive } from './story-fixtures.js';

	const { Story } = defineMeta({
		title: 'Headquarters/Pages/NoteEditor',
		component: NoteEditorPage,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' }
	});
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { createEditor, type Content } from '$lib/components/edra/shadcn/index.js';
	import type { NoteSaveStatus } from '$lib/crm/notes.js';
	import type { NoteColor } from '$lib/schemas/note.js';

	let title = $state('Call notes — Acme renewal');
	let color = $state<NoteColor>('blue');
	let pinned = $state(true);
	let saveStatus = $state<NoteSaveStatus>('idle');
	let timer: ReturnType<typeof setTimeout> | null = null;

	function touch() {
		saveStatus = 'dirty';
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			saveStatus = 'saving';
			timer = setTimeout(() => {
				saveStatus = 'saved';
				timer = setTimeout(() => (saveStatus = 'idle'), 2000);
			}, 500);
		}, 800);
	}

	const editor = createEditor({ onUpdate: touch });

	const sample: Content = {
		type: 'doc',
		content: [
			{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Renewal call' }] },
			{
				type: 'paragraph',
				content: [
					{ type: 'text', text: 'Spoke with Dana about renewal. They want a ' },
					{ type: 'text', marks: [{ type: 'bold' }], text: '3-year term' },
					{ type: 'text', text: ' with a price hold. Decision by end of month.' }
				]
			},
			{
				type: 'taskList',
				content: [
					{
						type: 'taskItem',
						attrs: { checked: true },
						content: [
							{ type: 'paragraph', content: [{ type: 'text', text: 'Send revised quote' }] }
						]
					},
					{
						type: 'taskItem',
						attrs: { checked: false },
						content: [
							{ type: 'paragraph', content: [{ type: 'text', text: 'Two reference customers' }] }
						]
					}
				]
			},
			{
				type: 'blockquote',
				content: [
					{
						type: 'paragraph',
						content: [{ type: 'text', text: '“Price is fine; we need predictability.” — Dana' }]
					}
				]
			}
		]
	};

	onMount(() => {
		editor?.commands.setContent(sample, { emitUpdate: false });
	});
</script>

<Story name="Default">
	{#snippet template()}
		<div class="h-screen">
			<NoteEditorPage
				orgName="Acme Org"
				navGroups={navGroupsWithActive('Notes')}
				{editor}
				{title}
				{color}
				{pinned}
				{saveStatus}
				onTitleChange={(value) => {
					title = value;
					touch();
				}}
				onColorChange={(value) => {
					color = value;
					touch();
				}}
				onTogglePin={() => {
					pinned = !pinned;
					touch();
				}}
				onDelete={() => {}}
			/>
		</div>
	{/snippet}
</Story>

<Story name="Conflict">
	{#snippet template()}
		<div class="h-screen">
			<NoteEditorPage
				orgName="Acme Org"
				navGroups={navGroupsWithActive('Notes')}
				{editor}
				{title}
				color="yellow"
				pinned={false}
				saveStatus="conflict"
				saveError="This note was changed elsewhere. Reload to see the latest version — your unsaved edits here will be discarded."
				onReload={() => {}}
				onDelete={() => {}}
			/>
		</div>
	{/snippet}
</Story>

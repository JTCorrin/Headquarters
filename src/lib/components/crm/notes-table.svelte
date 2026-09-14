<script lang="ts">
	import DataTableShell from './data-table-shell.svelte';
	import { createNoteColumns, notePinnedFacet, type NoteRow } from './notes-columns.js';

	export interface NotesTableProps {
		rows: NoteRow[];
		class?: string;
		emptyMessage?: string;
		onOpenNote?: (id: string) => void;
		onDeleteNote?: (id: string) => void;
	}

	let {
		rows,
		class: className,
		emptyMessage = 'No notes yet.',
		onOpenNote,
		onDeleteNote
	}: NotesTableProps = $props();

	const columns = $derived(createNoteColumns({ onOpen: onOpenNote, onDelete: onDeleteNote }));
</script>

<DataTableShell
	data={rows}
	{columns}
	facets={[notePinnedFacet]}
	pageSize={20}
	{emptyMessage}
	class={className}
/>

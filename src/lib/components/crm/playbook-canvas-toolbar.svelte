<script lang="ts">
	import { useOnSelectionChange, useSvelteFlow } from '@xyflow/svelte';

	let selectedCount = $state(0);

	useOnSelectionChange(({ nodes }) => {
		selectedCount = nodes.length;
	});

	const { getNodes, deleteElements } = useSvelteFlow();

	async function removeSelected() {
		const selected = getNodes().filter((n) => n.selected);
		if (selected.length === 0) return;
		await deleteElements({ nodes: selected.map((n) => ({ id: n.id })) });
	}
</script>

<button
	type="button"
	class="border-destructive/40 text-destructive hover:bg-destructive/10 rounded border bg-background px-2 py-1 text-xs font-medium disabled:pointer-events-none disabled:opacity-40"
	onclick={() => void removeSelected()}
	disabled={selectedCount === 0}
	title="Remove selected nodes (Delete / Backspace)"
>
	Remove selected{selectedCount ? ` (${selectedCount})` : ''}
</button>

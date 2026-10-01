<script lang="ts">
	import { Handle, Position, useSvelteFlow } from '@xyflow/svelte';
	import type { Node, NodeProps } from '@xyflow/svelte';

	type NoteData = { kind: string; body: string };
	type TNote = Node<NoteData, 'timelineNote'>;
	let { id, data }: NodeProps<TNote> = $props();

	const { updateNodeData } = useSvelteFlow();
</script>

<Handle type="target" position={Position.Top} class="!bg-muted-foreground" />
<div
	class="max-w-[260px] min-w-[200px] rounded-lg border border-border bg-card px-3 py-2 text-card-foreground shadow-sm"
>
	<div class="mb-2 text-xs font-semibold tracking-wide uppercase">Timeline note</div>
	<textarea
		class="nodrag nopan min-h-[64px] w-full rounded border border-input bg-background px-2 py-1 text-sm"
		placeholder="Note body (templates later)"
		value={data.body}
		oninput={(e) => updateNodeData(id, { ...data, body: (e.target as HTMLTextAreaElement).value })}
	></textarea>
</div>
<Handle type="source" position={Position.Bottom} class="!bg-primary" />

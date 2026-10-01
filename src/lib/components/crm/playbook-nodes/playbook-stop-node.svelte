<script lang="ts">
	import { Handle, Position, useSvelteFlow } from '@xyflow/svelte';
	import type { Node, NodeProps } from '@xyflow/svelte';

	type StopData = { reason: string };
	type TStop = Node<StopData, 'playbookStop'>;
	let { id, data }: NodeProps<TStop> = $props();

	const { updateNodeData } = useSvelteFlow();
</script>

<Handle type="target" position={Position.Top} class="!bg-muted-foreground" />
<div
	class="min-w-[160px] rounded-lg border border-border bg-card px-3 py-2 text-card-foreground shadow-sm"
>
	<div class="mb-2 text-xs font-semibold tracking-wide uppercase">Stop</div>
	<input
		type="text"
		class="nodrag nopan w-full rounded border border-input bg-background px-2 py-1 text-sm"
		placeholder="Reason (optional)"
		value={data.reason}
		oninput={(e) => updateNodeData(id, { reason: (e.target as HTMLInputElement).value })}
	/>
</div>

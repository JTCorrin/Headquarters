<script lang="ts">
	import { Handle, Position, useSvelteFlow } from '@xyflow/svelte';
	import type { Node, NodeProps } from '@xyflow/svelte';

	type LoopData = { relation: 'client.contacts' };
	type TLoop = Node<LoopData, 'loopRelated'>;
	let { id, data }: NodeProps<TLoop> = $props();

	const { updateNodeData } = useSvelteFlow();
</script>

<Handle type="target" position={Position.Top} class="!bg-muted-foreground" />
<div
	class="min-w-[200px] rounded-lg border border-border bg-card px-3 py-2 text-card-foreground shadow-sm"
>
	<div class="mb-2 text-xs font-semibold tracking-wide uppercase">Loop related</div>
	<select
		class="nodrag nopan w-full rounded border border-input bg-background px-2 py-1 text-sm"
		value={data.relation}
		onchange={(e) =>
			updateNodeData(id, {
				relation: (e.target as HTMLSelectElement).value as LoopData['relation']
			})}
	>
		<option value="client.contacts">Client → contacts</option>
	</select>
	<p class="mt-1 text-[10px] text-muted-foreground">Body steps: connect outgoing edges</p>
</div>
<Handle type="source" position={Position.Bottom} class="!bg-primary" />

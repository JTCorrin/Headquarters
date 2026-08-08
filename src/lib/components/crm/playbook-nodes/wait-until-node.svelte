<script lang="ts">
	import { Handle, Position, useSvelteFlow } from '@xyflow/svelte';
	import type { Node, NodeProps } from '@xyflow/svelte';

	type WaitUntilData = { time: string; timezone: string };
	type TWait = Node<WaitUntilData, 'waitUntil'>;
	let { id, data }: NodeProps<TWait> = $props();

	const { updateNodeData } = useSvelteFlow();
</script>

<Handle type="target" position={Position.Top} class="!bg-muted-foreground" />
<div
	class="border-border bg-card text-card-foreground min-w-[180px] rounded-lg border px-3 py-2 shadow-sm"
>
	<div class="mb-2 text-xs font-semibold tracking-wide uppercase">Wait until</div>
	<input
		type="time"
		class="border-input bg-background nodrag nopan w-full rounded border px-2 py-1 text-sm"
		value={data.time}
		oninput={(e) => updateNodeData(id, { ...data, time: (e.target as HTMLInputElement).value })}
	/>
	<input
		type="text"
		class="border-input bg-background nodrag nopan mt-2 w-full rounded border px-2 py-1 text-xs"
		placeholder="Timezone (optional, org default)"
		value={data.timezone}
		oninput={(e) =>
			updateNodeData(id, { ...data, timezone: (e.target as HTMLInputElement).value })}
	/>
</div>
<Handle type="source" position={Position.Bottom} class="!bg-primary" />

<script lang="ts">
	import { Handle, Position, useSvelteFlow } from '@xyflow/svelte';
	import type { Node, NodeProps } from '@xyflow/svelte';

	type WaitData = { duration: number; unit: 'minutes' | 'hours' | 'days' };
	type TWait = Node<WaitData, 'wait'>;
	let { id, data }: NodeProps<TWait> = $props();

	const { updateNodeData } = useSvelteFlow();
</script>

<Handle type="target" position={Position.Top} class="!bg-muted-foreground" />
<div
	class="border-border bg-card text-card-foreground min-w-[180px] rounded-lg border px-3 py-2 shadow-sm"
>
	<div class="mb-2 text-xs font-semibold tracking-wide uppercase">Wait</div>
	<div class="flex gap-2">
		<input
			type="number"
			min="1"
			step="1"
			class="border-input bg-background nodrag nopan w-16 rounded border px-2 py-1 text-sm"
			value={data.duration}
			oninput={(e) => {
				const v = Number((e.target as HTMLInputElement).value);
				if (Number.isFinite(v) && v > 0) updateNodeData(id, { ...data, duration: v });
			}}
		/>
		<select
			class="border-input bg-background nodrag nopan flex-1 rounded border px-2 py-1 text-sm"
			value={data.unit}
			onchange={(e) =>
				updateNodeData(id, {
					...data,
					unit: (e.target as HTMLSelectElement).value as WaitData['unit']
				})}
		>
			<option value="minutes">Minutes</option>
			<option value="hours">Hours</option>
			<option value="days">Days</option>
		</select>
	</div>
</div>
<Handle type="source" position={Position.Bottom} class="!bg-primary" />

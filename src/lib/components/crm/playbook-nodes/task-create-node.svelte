<script lang="ts">
	import { Handle, Position, useSvelteFlow } from '@xyflow/svelte';
	import type { Node, NodeProps } from '@xyflow/svelte';

	type TaskData = {
		title: string;
		description: string;
		assigneeMembershipId: string;
		priority: 'p1' | 'p2' | 'p3' | 'p4';
		dueOffsetDays: number;
	};
	type TTask = Node<TaskData, 'taskCreate'>;
	let { id, data }: NodeProps<TTask> = $props();

	const { updateNodeData } = useSvelteFlow();
</script>

<Handle type="target" position={Position.Top} class="!bg-muted-foreground" />
<div
	class="max-w-[260px] min-w-[200px] rounded-lg border border-border bg-card px-3 py-2 text-card-foreground shadow-sm"
>
	<div class="mb-2 text-xs font-semibold tracking-wide uppercase">Create task</div>
	<input
		type="text"
		class="nodrag nopan mb-2 w-full rounded border border-input bg-background px-2 py-1 text-sm"
		placeholder="Title"
		value={data.title}
		oninput={(e) => updateNodeData(id, { ...data, title: (e.target as HTMLInputElement).value })}
	/>
	<select
		class="nodrag nopan mb-2 w-full rounded border border-input bg-background px-2 py-1 text-sm"
		value={data.priority}
		onchange={(e) =>
			updateNodeData(id, {
				...data,
				priority: (e.target as HTMLSelectElement).value as TaskData['priority']
			})}
	>
		<option value="p1">P1</option>
		<option value="p2">P2</option>
		<option value="p3">P3</option>
		<option value="p4">P4</option>
	</select>
	<label class="flex items-center gap-2 text-xs text-muted-foreground">
		Due in
		<input
			type="number"
			min="0"
			class="nodrag nopan w-16 rounded border border-input bg-background px-2 py-1 text-sm"
			value={data.dueOffsetDays}
			oninput={(e) =>
				updateNodeData(id, {
					...data,
					dueOffsetDays: Number((e.target as HTMLInputElement).value) || 0
				})}
		/>
		days
	</label>
</div>
<Handle type="source" position={Position.Bottom} class="!bg-primary" />

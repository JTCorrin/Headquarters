<script lang="ts">
	import { Handle, Position, useSvelteFlow } from '@xyflow/svelte';
	import type { Node, NodeProps } from '@xyflow/svelte';

	type NotifData = { title: string; body: string; recipientMembershipIds: string[] };
	type TNotif = Node<NotifData, 'notificationCreate'>;
	let { id, data }: NodeProps<TNotif> = $props();

	const { updateNodeData } = useSvelteFlow();
</script>

<Handle type="target" position={Position.Top} class="!bg-muted-foreground" />
<div
	class="max-w-[260px] min-w-[200px] rounded-lg border border-border bg-card px-3 py-2 text-card-foreground shadow-sm"
>
	<div class="mb-2 text-xs font-semibold tracking-wide uppercase">Notify</div>
	<input
		type="text"
		class="nodrag nopan mb-2 w-full rounded border border-input bg-background px-2 py-1 text-sm"
		placeholder="Title"
		value={data.title}
		oninput={(e) => updateNodeData(id, { ...data, title: (e.target as HTMLInputElement).value })}
	/>
	<input
		type="text"
		class="nodrag nopan w-full rounded border border-input bg-background px-2 py-1 text-sm"
		placeholder="Body"
		value={data.body}
		oninput={(e) => updateNodeData(id, { ...data, body: (e.target as HTMLInputElement).value })}
	/>
	<p class="mt-1 text-[10px] text-muted-foreground">Recipients: entity owner (runtime)</p>
</div>
<Handle type="source" position={Position.Bottom} class="!bg-primary" />

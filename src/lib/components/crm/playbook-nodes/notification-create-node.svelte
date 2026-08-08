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
	class="border-border bg-card text-card-foreground min-w-[200px] max-w-[260px] rounded-lg border px-3 py-2 shadow-sm"
>
	<div class="mb-2 text-xs font-semibold tracking-wide uppercase">Notify</div>
	<input
		type="text"
		class="border-input bg-background nodrag nopan mb-2 w-full rounded border px-2 py-1 text-sm"
		placeholder="Title"
		value={data.title}
		oninput={(e) => updateNodeData(id, { ...data, title: (e.target as HTMLInputElement).value })}
	/>
	<input
		type="text"
		class="border-input bg-background nodrag nopan w-full rounded border px-2 py-1 text-sm"
		placeholder="Body"
		value={data.body}
		oninput={(e) => updateNodeData(id, { ...data, body: (e.target as HTMLInputElement).value })}
	/>
	<p class="text-muted-foreground mt-1 text-[10px]">Recipients: entity owner (runtime)</p>
</div>
<Handle type="source" position={Position.Bottom} class="!bg-primary" />

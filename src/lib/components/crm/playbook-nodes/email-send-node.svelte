<script lang="ts">
	import { getContext } from 'svelte';
	import { Handle, Position, useSvelteFlow } from '@xyflow/svelte';
	import type { Node, NodeProps } from '@xyflow/svelte';
	import { PLAYBOOK_TEMPLATES_CTX } from '$lib/playbook/playbook-context.js';

	type TemplateOpt = { id: string; name: string };
	type EmailData = { templateId: string; mailboxId: string; to: string };
	type TSend = Node<EmailData, 'emailSend'>;
	let { id, data }: NodeProps<TSend> = $props();

	const { updateNodeData } = useSvelteFlow();
	const getTemplates = getContext<(() => TemplateOpt[]) | undefined>(PLAYBOOK_TEMPLATES_CTX);
	const templates = $derived(getTemplates?.() ?? []);
</script>

<Handle type="target" position={Position.Top} class="!bg-muted-foreground" />
<div
	class="max-w-[260px] min-w-[200px] rounded-lg border border-border bg-card px-3 py-2 text-card-foreground shadow-sm"
>
	<div class="mb-2 text-xs font-semibold tracking-wide uppercase">Send email</div>
	<select
		class="nodrag nopan mb-2 w-full rounded border border-input bg-background px-2 py-1 text-sm"
		value={data.templateId}
		onchange={(e) =>
			updateNodeData(id, { ...data, templateId: (e.target as HTMLSelectElement).value })}
	>
		<option value="">Select template…</option>
		{#each templates as t (t.id)}
			<option value={t.id}>{t.name}</option>
		{/each}
	</select>
	<select
		class="nodrag nopan w-full rounded border border-input bg-background px-2 py-1 text-sm"
		value={data.to}
		onchange={(e) => updateNodeData(id, { ...data, to: (e.target as HTMLSelectElement).value })}
	>
		<option value="entity_primary">Entity primary email</option>
		<option value="related_contact">Related contact</option>
	</select>
</div>
<Handle type="source" position={Position.Bottom} class="!bg-primary" />

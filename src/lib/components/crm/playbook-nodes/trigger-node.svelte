<script lang="ts">
	import { Handle, Position, useSvelteFlow } from '@xyflow/svelte';
	import type { Node, NodeProps } from '@xyflow/svelte';
	import type { PlaybookTriggerKind } from '$lib/schemas/playbook-graph.js';

	type TriggerData = { kind: PlaybookTriggerKind; config: Record<string, unknown> };
	type TTrigger = Node<TriggerData, 'trigger'>;
	let { id, data }: NodeProps<TTrigger> = $props();

	const { updateNodeData } = useSvelteFlow();

	const kinds: { value: PlaybookTriggerKind; label: string }[] = [
		{ value: 'manual.run', label: 'Manual run' },
		{ value: 'email.received', label: 'Incoming email' },
		{ value: 'invoice.outstanding_days', label: 'Invoice outstanding X days' },
		{ value: 'payment.received', label: 'Payment received' },
		{ value: 'invoice.sent', label: 'Invoice sent' },
		{ value: 'schedule.cron', label: 'Schedule (cron)' }
	];

	function setKind(e: Event) {
		const kind = (e.target as HTMLSelectElement).value as PlaybookTriggerKind;
		const config: Record<string, unknown> = {};
		if (kind === 'invoice.outstanding_days') {
			config.days = Number(data.config?.days) || 7;
			config.basis = (data.config?.basis as string) || 'due_on';
		}
		if (kind === 'schedule.cron') {
			config.cron = (data.config?.cron as string) || '0 9 * * *';
		}
		updateNodeData(id, { kind, config });
	}

	function patchConfig(key: string, value: unknown) {
		updateNodeData(id, { ...data, config: { ...data.config, [key]: value } });
	}
</script>

<div
	class="border-border bg-card text-card-foreground min-w-[220px] rounded-lg border px-3 py-2 shadow-sm"
>
	<div class="mb-2 text-xs font-semibold tracking-wide uppercase">Trigger</div>
	<select
		class="border-input bg-background nodrag nopan w-full rounded border px-2 py-1 text-sm"
		value={data.kind}
		onchange={setKind}
	>
		{#each kinds as k (k.value)}
			<option value={k.value}>{k.label}</option>
		{/each}
	</select>
	{#if data.kind === 'invoice.outstanding_days'}
		<div class="mt-2 flex gap-2">
			<input
				type="number"
				min="1"
				class="border-input bg-background nodrag nopan w-16 rounded border px-2 py-1 text-sm"
				value={Number(data.config?.days) || 7}
				oninput={(e) => patchConfig('days', Number((e.target as HTMLInputElement).value))}
			/>
			<select
				class="border-input bg-background nodrag nopan flex-1 rounded border px-2 py-1 text-sm"
				value={(data.config?.basis as string) || 'due_on'}
				onchange={(e) => patchConfig('basis', (e.target as HTMLSelectElement).value)}
			>
				<option value="due_on">After due</option>
				<option value="issue_on">After issue</option>
			</select>
		</div>
	{/if}
	{#if data.kind === 'schedule.cron'}
		<input
			type="text"
			class="border-input bg-background nodrag nopan mt-2 w-full rounded border px-2 py-1 text-xs"
			placeholder="Cron (e.g. 0 9 * * *)"
			value={(data.config?.cron as string) || ''}
			oninput={(e) => patchConfig('cron', (e.target as HTMLInputElement).value)}
		/>
	{/if}
</div>
<Handle type="source" position={Position.Bottom} class="!bg-primary" />

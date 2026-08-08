<script lang="ts">
	import {
		Background,
		BackgroundVariant,
		ConnectionLineType,
		Controls,
		Panel,
		SvelteFlow,
		addEdge,
		type Connection,
		type Edge,
		type Node,
		type OnConnectEnd
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import {
		ADDABLE_NODE_LABELS,
		defaultDataForNodeType,
		type AddableNodeKind
	} from '$lib/playbook/playbook-flow.js';
	import { newPlaybookNodeId } from '$lib/playbook/playbook-id.js';
	import PlaybookCanvasToolbar from './playbook-canvas-toolbar.svelte';
	import TriggerNode from './playbook-nodes/trigger-node.svelte';
	import WaitNode from './playbook-nodes/wait-node.svelte';
	import WaitUntilNode from './playbook-nodes/wait-until-node.svelte';
	import EmailSendNode from './playbook-nodes/email-send-node.svelte';
	import TaskCreateNode from './playbook-nodes/task-create-node.svelte';
	import TimelineNoteNode from './playbook-nodes/timeline-note-node.svelte';
	import NotificationCreateNode from './playbook-nodes/notification-create-node.svelte';
	import PlaybookStopNode from './playbook-nodes/playbook-stop-node.svelte';
	import LoopRelatedNode from './playbook-nodes/loop-related-node.svelte';

	interface Props {
		nodes?: Node[];
		edges?: Edge[];
	}

	let { nodes = $bindable<Node[]>([]), edges = $bindable<Edge[]>([]) }: Props = $props();

	type InsertPicker = {
		sourceId: string;
		flowX: number;
		flowY: number;
		screenX: number;
		screenY: number;
	};

	let insertPicker = $state<InsertPicker | null>(null);
	let blockInsertPickerPaneDismiss = false;

	const nodeTypes = {
		trigger: TriggerNode,
		wait: WaitNode,
		waitUntil: WaitUntilNode,
		emailSend: EmailSendNode,
		taskCreate: TaskCreateNode,
		timelineNote: TimelineNoteNode,
		notificationCreate: NotificationCreateNode,
		playbookStop: PlaybookStopNode,
		loopRelated: LoopRelatedNode
	};

	const hasTrigger = $derived(nodes.some((n) => n.type === 'trigger'));

	function onConnect(c: Connection) {
		edges = addEdge(c, edges);
	}

	function clientPoint(event: MouseEvent | TouchEvent): { x: number; y: number } {
		if ('clientX' in event) {
			return { x: event.clientX, y: event.clientY };
		}
		const t = event.changedTouches[0];
		return t ? { x: t.clientX, y: t.clientY } : { x: 0, y: 0 };
	}

	const onConnectEnd: OnConnectEnd = (event, state) => {
		if (!state.fromHandle || state.fromHandle.type !== 'source') return;
		if (state.toHandle) {
			insertPicker = null;
			return;
		}
		if (!state.pointer) return;
		const { x: screenX, y: screenY } = clientPoint(event);
		blockInsertPickerPaneDismiss = true;
		insertPicker = {
			sourceId: state.fromHandle.nodeId,
			flowX: state.pointer.x,
			flowY: state.pointer.y,
			screenX,
			screenY
		};
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				blockInsertPickerPaneDismiss = false;
			});
		});
	};

	function onPaneClick() {
		if (!insertPicker || blockInsertPickerPaneDismiss) return;
		insertPicker = null;
	}

	function addNode(kind: AddableNodeKind, position?: { x: number; y: number }, sourceId?: string) {
		const newId = newPlaybookNodeId();
		const pos = position ?? {
			x: 280 + Math.random() * 80,
			y: 120 + Math.random() * 80
		};
		const node: Node = {
			id: newId,
			type: kind,
			position: pos,
			data: defaultDataForNodeType(kind)
		};
		nodes = [...nodes, node];
		if (sourceId) {
			const conn: Connection = {
				source: sourceId,
				target: newId,
				sourceHandle: null,
				targetHandle: null
			};
			edges = addEdge(conn, edges);
		}
	}

	function addNodeFromInsertPicker(kind: AddableNodeKind) {
		if (!insertPicker) return;
		const { sourceId, flowX, flowY } = insertPicker;
		addNode(kind, { x: flowX - 90, y: flowY - 24 }, sourceId);
		insertPicker = null;
	}

	function addTrigger() {
		if (hasTrigger) return;
		nodes = [
			...nodes,
			{
				id: newPlaybookNodeId(),
				type: 'trigger',
				position: { x: 120, y: 180 },
				data: { kind: 'manual.run', config: {} }
			}
		];
	}
</script>

<div
	class="bg-muted/30 relative h-[min(70vh,640px)] min-h-[420px] w-full overflow-hidden rounded-lg border"
>
	{#if insertPicker}
		<div
			role="dialog"
			aria-label="Add node on connection"
			class="bg-popover text-popover-foreground pointer-events-auto fixed z-[200] flex max-w-[16rem] min-w-[10rem] flex-col gap-2 rounded-md border p-2 shadow-md"
			style:left="{insertPicker.screenX}px"
			style:top="{insertPicker.screenY}px"
			style:translate="-8px 8px"
		>
			<div class="text-muted-foreground text-xs font-medium">Insert node</div>
			<div class="flex flex-wrap gap-1.5">
				{#each ADDABLE_NODE_LABELS as item (item.type)}
					<button
						type="button"
						class="bg-secondary text-secondary-foreground hover:bg-secondary/90 rounded px-2 py-1 text-xs font-medium"
						onclick={() => addNodeFromInsertPicker(item.type)}>{item.label}</button
					>
				{/each}
				<button
					type="button"
					class="border-input hover:bg-muted rounded border bg-background px-2 py-1 text-xs"
					onclick={() => (insertPicker = null)}>Cancel</button
				>
			</div>
		</div>
	{/if}
	<SvelteFlow
		bind:nodes
		bind:edges
		{nodeTypes}
		fitView
		deleteKey={['Backspace', 'Delete']}
		onconnect={onConnect}
		onconnectend={onConnectEnd}
		connectionLineType={ConnectionLineType.Bezier}
		onpaneclick={onPaneClick}
		proOptions={{ hideAttribution: true }}
	>
		<Controls showFitView showZoom position="bottom-right" />
		<Background gap={16} size={1} variant={BackgroundVariant.Dots} />
		<Panel position="top-left">
			<div
				class="bg-background/95 flex max-w-[min(100%,42rem)] flex-wrap items-center gap-2 rounded-md border p-2 shadow-sm backdrop-blur"
			>
				<button
					type="button"
					class="bg-secondary text-secondary-foreground hover:bg-secondary/90 rounded px-2 py-1 text-xs font-medium disabled:opacity-40"
					onclick={addTrigger}
					disabled={hasTrigger}>+ Trigger</button
				>
				{#each ADDABLE_NODE_LABELS as item (item.type)}
					<button
						type="button"
						class="bg-secondary text-secondary-foreground hover:bg-secondary/90 rounded px-2 py-1 text-xs font-medium"
						onclick={() => addNode(item.type)}>+ {item.label}</button
					>
				{/each}
				<PlaybookCanvasToolbar />
			</div>
		</Panel>
	</SvelteFlow>
</div>

<script lang="ts">
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';

	export interface DataTableRowActionsProps {
		id: string;
		label?: string;
		/** Navigate here when View is chosen (client-side route). */
		viewHref?: string;
		onView?: () => void;
		onEdit?: () => void;
		onDelete?: () => void;
	}

	let { id, label = 'row', viewHref, onView, onEdit, onDelete }: DataTableRowActionsProps =
		$props();

	function handleView() {
		if (onView) {
			onView();
			return;
		}
		if (viewHref) void goto(viewHref);
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="ghost" size="icon" class="relative size-8 p-0">
				<span class="sr-only">Open {label} actions</span>
				<EllipsisIcon />
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end">
		<DropdownMenu.Group>
			<DropdownMenu.Label>Actions</DropdownMenu.Label>
			<DropdownMenu.Item onclick={() => navigator.clipboard.writeText(id)}>
				Copy {label} ID
			</DropdownMenu.Item>
		</DropdownMenu.Group>
		<DropdownMenu.Separator />
		<DropdownMenu.Item disabled={!onView && !viewHref} onclick={handleView}>View</DropdownMenu.Item>
		<DropdownMenu.Item disabled={!onEdit} onclick={() => onEdit?.()}>Edit</DropdownMenu.Item>
		{#if onDelete}
			<DropdownMenu.Separator />
			<DropdownMenu.Item variant="destructive" onclick={() => onDelete?.()}>
				Delete
			</DropdownMenu.Item>
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>

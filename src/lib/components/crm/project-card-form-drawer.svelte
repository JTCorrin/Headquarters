<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { ProjectCardFormData } from '$lib/schemas/project.js';
	import * as Drawer from '$lib/components/ui/drawer/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import ProjectCardForm from './project-card-form.svelte';
	import { cn } from '$lib/utils.js';

	export interface ProjectCardFormDrawerProps {
		form: SuperForm<ProjectCardFormData>;
		open?: boolean;
		title?: string;
		description?: string;
		submitLabel?: string;
		showTrigger?: boolean;
		triggerLabel?: string;
		class?: string;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
		onDelete?: () => void | Promise<void>;
	}

	let {
		form,
		open = $bindable(false),
		title = 'Card',
		description = 'Title, description, and due date for this project card.',
		submitLabel = 'Save card',
		showTrigger = false,
		triggerLabel = 'Add card',
		class: className,
		onValidSubmit,
		onDelete
	}: ProjectCardFormDrawerProps = $props();
</script>

<Drawer.Root bind:open direction="bottom" shouldScaleBackground={false}>
	{#if showTrigger}
		<Drawer.Trigger>
			{#snippet child({ props })}
				<Button type="button" size="sm" {...props}>{triggerLabel}</Button>
			{/snippet}
		</Drawer.Trigger>
	{/if}

	<Drawer.Content class={cn('mx-auto w-full max-w-lg', className)}>
		<Drawer.Header class="text-left">
			<Drawer.Title>{title}</Drawer.Title>
			<Drawer.Description>{description}</Drawer.Description>
		</Drawer.Header>
		<div class="overflow-y-auto px-4 pb-2">
			<ProjectCardForm
				{form}
				{submitLabel}
				{onValidSubmit}
				{onDelete}
				class="max-w-none"
			/>
		</div>
		<Drawer.Footer class="pt-0">
			<Drawer.Close>
				<Button type="button" variant="outline">Cancel</Button>
			</Drawer.Close>
		</Drawer.Footer>
	</Drawer.Content>
</Drawer.Root>

<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { TaskAssigneeOption, TaskFormData } from '$lib/schemas/task.js';
	import * as Drawer from '$lib/components/ui/drawer/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import TaskForm from './task-form.svelte';
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	export interface TaskFormDrawerProps {
		form: SuperForm<TaskFormData>;
		assigneeOptions?: TaskAssigneeOption[];
		open?: boolean;
		title?: string;
		description?: string;
		submitLabel?: string;
		triggerLabel?: string;
		showTrigger?: boolean;
		class?: string;
		trigger?: Snippet;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		assigneeOptions = [],
		open = $bindable(false),
		title = 'New task',
		description = 'Create a follow-up for your team.',
		submitLabel = 'Save task',
		triggerLabel = 'New task',
		showTrigger = true,
		class: className,
		trigger,
		onValidSubmit
	}: TaskFormDrawerProps = $props();
</script>

<Drawer.Root bind:open direction="bottom" shouldScaleBackground={false}>
	{#if showTrigger}
		{#if trigger}
			<Drawer.Trigger>
				{@render trigger()}
			</Drawer.Trigger>
		{:else}
			<Drawer.Trigger>
				{#snippet child({ props })}
					<Button type="button" size="sm" {...props}>{triggerLabel}</Button>
				{/snippet}
			</Drawer.Trigger>
		{/if}
	{/if}

	<Drawer.Content class={cn('mx-auto w-full max-w-lg', className)}>
		<Drawer.Header class="text-left">
			<Drawer.Title>{title}</Drawer.Title>
			<Drawer.Description>{description}</Drawer.Description>
		</Drawer.Header>
		<div class="overflow-y-auto px-4 pb-2">
			<TaskForm {form} {assigneeOptions} {submitLabel} {onValidSubmit} class="max-w-none" />
		</div>
		<Drawer.Footer class="pt-0">
			<Drawer.Close>
				<Button type="button" variant="outline">Cancel</Button>
			</Drawer.Close>
		</Drawer.Footer>
	</Drawer.Content>
</Drawer.Root>

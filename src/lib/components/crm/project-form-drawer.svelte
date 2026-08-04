<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { ProjectFormData } from '$lib/schemas/project.js';
	import * as Drawer from '$lib/components/ui/drawer/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import ProjectForm, { type ProjectClientOption } from './project-form.svelte';
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	export interface ProjectFormDrawerProps {
		form: SuperForm<ProjectFormData>;
		clients?: ProjectClientOption[];
		open?: boolean;
		title?: string;
		description?: string;
		submitLabel?: string;
		triggerLabel?: string;
		showTrigger?: boolean;
		allowArchived?: boolean;
		class?: string;
		trigger?: Snippet;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		clients = [],
		open = $bindable(false),
		title = 'New project',
		description = 'Projects attach to a client and open as their own kanban workspace.',
		submitLabel = 'Save project',
		triggerLabel = 'New project',
		showTrigger = true,
		allowArchived = false,
		class: className,
		trigger,
		onValidSubmit
	}: ProjectFormDrawerProps = $props();
</script>

<Drawer.Root bind:open direction="bottom" shouldScaleBackground={false}>
	{#if showTrigger}
		{#if trigger}
			<Drawer.Trigger>
				{#snippet child({ props })}
					<span class="inline-flex" {...props}>{@render trigger()}</span>
				{/snippet}
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
			<ProjectForm
				{form}
				{clients}
				{submitLabel}
				{allowArchived}
				{onValidSubmit}
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

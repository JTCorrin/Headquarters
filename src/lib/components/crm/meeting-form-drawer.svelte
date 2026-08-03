<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { MeetingFormData } from '$lib/schemas/meeting.js';
	import * as Drawer from '$lib/components/ui/drawer/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import MeetingForm from './meeting-form.svelte';
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	export interface MeetingFormDrawerProps {
		form: SuperForm<MeetingFormData>;
		open?: boolean;
		title?: string;
		description?: string;
		submitLabel?: string;
		triggerLabel?: string;
		class?: string;
		trigger?: Snippet;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		open = $bindable(false),
		title = 'Schedule meeting',
		description = 'Link attendees and a client, contact, or lead when you know them.',
		submitLabel = 'Save meeting',
		triggerLabel = 'New meeting',
		class: className,
		trigger,
		onValidSubmit
	}: MeetingFormDrawerProps = $props();
</script>

<Drawer.Root bind:open direction="bottom" shouldScaleBackground={false}>
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

	<Drawer.Content class={cn('mx-auto w-full max-w-lg', className)}>
		<Drawer.Header class="text-left">
			<Drawer.Title>{title}</Drawer.Title>
			<Drawer.Description>{description}</Drawer.Description>
		</Drawer.Header>
		<div class="overflow-y-auto px-4 pb-2">
			<MeetingForm {form} {submitLabel} {onValidSubmit} class="max-w-none" />
		</div>
		<Drawer.Footer class="pt-0">
			<Drawer.Close>
				<Button type="button" variant="outline">Cancel</Button>
			</Drawer.Close>
		</Drawer.Footer>
	</Drawer.Content>
</Drawer.Root>

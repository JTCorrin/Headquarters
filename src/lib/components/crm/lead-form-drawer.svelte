<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { LeadClientOption, LeadFormData } from '$lib/schemas/lead.js';
	import * as Drawer from '$lib/components/ui/drawer/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import LeadForm from './lead-form.svelte';
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	export interface LeadFormDrawerProps {
		form: SuperForm<LeadFormData>;
		clientOptions?: LeadClientOption[];
		orgCurrency?: string | null;
		open?: boolean;
		title?: string;
		description?: string;
		submitLabel?: string;
		triggerLabel?: string;
		class?: string;
		trigger?: Snippet;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
		onCreateClient?: () => void;
	}

	let {
		form,
		clientOptions = [],
		orgCurrency = null,
		open = $bindable(false),
		title = 'New lead',
		description = 'Create a pipeline lead. Mark won only via Convert on the lead detail.',
		submitLabel = 'Save lead',
		triggerLabel = 'New lead',
		class: className,
		trigger,
		onValidSubmit,
		onCreateClient
	}: LeadFormDrawerProps = $props();
</script>

<Drawer.Root bind:open direction="bottom" shouldScaleBackground={false}>
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

	<Drawer.Content class={cn('mx-auto w-full max-w-lg', className)}>
		<Drawer.Header class="text-left">
			<Drawer.Title>{title}</Drawer.Title>
			<Drawer.Description>{description}</Drawer.Description>
		</Drawer.Header>
		<div class="overflow-y-auto px-4 pb-2">
			<LeadForm
				{form}
				{clientOptions}
				{orgCurrency}
				{submitLabel}
				{onValidSubmit}
				{onCreateClient}
			/>
		</div>
		<Drawer.Footer class="pt-0">
			<Drawer.Close>
				<Button type="button" variant="outline">Cancel</Button>
			</Drawer.Close>
		</Drawer.Footer>
	</Drawer.Content>
</Drawer.Root>

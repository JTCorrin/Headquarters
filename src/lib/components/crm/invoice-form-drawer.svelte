<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { InvoiceFormData } from '$lib/schemas/invoice.js';
	import * as Drawer from '$lib/components/ui/drawer/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import InvoiceForm from './invoice-form.svelte';
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	export interface InvoiceFormDrawerProps {
		form: SuperForm<InvoiceFormData>;
		open?: boolean;
		title?: string;
		description?: string;
		submitLabel?: string;
		triggerLabel?: string;
		class?: string;
		trigger?: Snippet;
	}

	let {
		form,
		open = $bindable(false),
		title = 'New invoice',
		description = 'Create an invoice with a first line item.',
		submitLabel = 'Save invoice',
		triggerLabel = 'New invoice',
		class: className,
		trigger
	}: InvoiceFormDrawerProps = $props();
</script>

<Drawer.Root bind:open direction="bottom" shouldScaleBackground={false}>
	{#if trigger}
		<Drawer.Trigger>
			{@render trigger()}
		</Drawer.Trigger>
	{:else}
		<Drawer.Trigger>
			<Button type="button">{triggerLabel}</Button>
		</Drawer.Trigger>
	{/if}

	<Drawer.Content class={cn('mx-auto w-full max-w-lg', className)}>
		<Drawer.Header class="text-left">
			<Drawer.Title>{title}</Drawer.Title>
			<Drawer.Description>{description}</Drawer.Description>
		</Drawer.Header>
		<div class="overflow-y-auto px-4 pb-2">
			<InvoiceForm {form} {submitLabel} />
		</div>
		<Drawer.Footer class="pt-0">
			<Drawer.Close>
				<Button type="button" variant="outline">Cancel</Button>
			</Drawer.Close>
		</Drawer.Footer>
	</Drawer.Content>
</Drawer.Root>

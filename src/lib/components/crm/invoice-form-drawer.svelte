<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type {
		InvoiceClientOption,
		InvoiceContactOption,
		InvoiceFormData,
		InvoiceQuoteOption
	} from '$lib/schemas/invoice.js';
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
		clientOptions?: InvoiceClientOption[];
		contactOptions?: InvoiceContactOption[];
		quoteOptions?: InvoiceQuoteOption[];
		class?: string;
		trigger?: Snippet;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		open = $bindable(false),
		title = 'New invoice',
		description = 'Create a blank draft or convert an accepted quote. Add line items on the invoice page.',
		submitLabel = 'Save invoice',
		triggerLabel = 'New invoice',
		clientOptions = [],
		contactOptions = [],
		quoteOptions = [],
		class: className,
		trigger,
		onValidSubmit
	}: InvoiceFormDrawerProps = $props();
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
			<InvoiceForm
				{form}
				{submitLabel}
				{clientOptions}
				{contactOptions}
				{quoteOptions}
				showQuotePrefill
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

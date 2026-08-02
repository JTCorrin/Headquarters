<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type {
		RecurringInvoiceClientOption,
		RecurringInvoiceContactOption,
		RecurringInvoiceFormData
	} from '$lib/schemas/recurring-invoice.js';
	import * as Drawer from '$lib/components/ui/drawer/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import RecurringInvoiceForm from './recurring-invoice-form.svelte';
	import { cn } from '$lib/utils.js';

	export interface RecurringInvoiceFormDrawerProps {
		form: SuperForm<RecurringInvoiceFormData>;
		open?: boolean;
		title?: string;
		description?: string;
		submitLabel?: string;
		triggerLabel?: string;
		clientOptions?: RecurringInvoiceClientOption[];
		contactOptions?: RecurringInvoiceContactOption[];
		class?: string;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		open = $bindable(false),
		title = 'New recurring schedule',
		description = 'Define billing cadence and lines. Activate when ready — generation stays draft-only in this slice.',
		submitLabel = 'Save schedule',
		triggerLabel = 'New schedule',
		clientOptions = [],
		contactOptions = [],
		class: className,
		onValidSubmit
	}: RecurringInvoiceFormDrawerProps = $props();
</script>

<Drawer.Root bind:open direction="bottom" shouldScaleBackground={false}>
	<Drawer.Trigger>
		{#snippet child({ props })}
			<Button type="button" size="sm" {...props}>{triggerLabel}</Button>
		{/snippet}
	</Drawer.Trigger>

	<Drawer.Content class={cn('mx-auto w-full max-w-lg', className)}>
		<Drawer.Header class="text-left">
			<Drawer.Title>{title}</Drawer.Title>
			<Drawer.Description>{description}</Drawer.Description>
		</Drawer.Header>
		<div class="overflow-y-auto px-4 pb-2">
			<RecurringInvoiceForm
				{form}
				{submitLabel}
				{clientOptions}
				{contactOptions}
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

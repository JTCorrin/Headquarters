<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { PaymentFormData } from '$lib/schemas/payment.js';
	import * as Drawer from '$lib/components/ui/drawer/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import PaymentForm from './payment-form.svelte';
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	export interface PaymentFormDrawerProps {
		form: SuperForm<PaymentFormData>;
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
		title = 'Record payment',
		description = 'Match a payment to a client / invoice, or leave it unallocated.',
		submitLabel = 'Save payment',
		triggerLabel = 'Record payment',
		class: className,
		trigger
	}: PaymentFormDrawerProps = $props();
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
			<PaymentForm {form} {submitLabel} />
		</div>
		<Drawer.Footer class="pt-0">
			<Drawer.Close>
				<Button type="button" variant="outline">Cancel</Button>
			</Drawer.Close>
		</Drawer.Footer>
	</Drawer.Content>
</Drawer.Root>

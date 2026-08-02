<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { VendorFormData } from '$lib/schemas/vendor.js';
	import * as Drawer from '$lib/components/ui/drawer/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import VendorForm from './vendor-form.svelte';
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	export interface VendorFormDrawerProps {
		form: SuperForm<VendorFormData>;
		open?: boolean;
		title?: string;
		description?: string;
		submitLabel?: string;
		triggerLabel?: string;
		/** When false, drawer is controlled only via `open` (no trigger button). */
		showTrigger?: boolean;
		class?: string;
		trigger?: Snippet;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		open = $bindable(false),
		title = 'New vendor',
		description = 'Add a vendor for accounts payable bills.',
		submitLabel = 'Save vendor',
		triggerLabel = 'New vendor',
		showTrigger = true,
		class: className,
		trigger,
		onValidSubmit
	}: VendorFormDrawerProps = $props();
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
			<VendorForm {form} {submitLabel} {onValidSubmit} />
		</div>
		<Drawer.Footer class="pt-0">
			<Drawer.Close>
				<Button type="button" variant="outline">Cancel</Button>
			</Drawer.Close>
		</Drawer.Footer>
	</Drawer.Content>
</Drawer.Root>

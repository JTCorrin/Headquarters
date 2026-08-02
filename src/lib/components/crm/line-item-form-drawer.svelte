<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { CatalogProductOption, LineItemFormData } from '$lib/schemas/line-item.js';
	import * as Drawer from '$lib/components/ui/drawer/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import LineItemForm from './line-item-form.svelte';
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	export interface LineItemFormDrawerProps {
		form: SuperForm<LineItemFormData>;
		products?: CatalogProductOption[];
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
		products = [],
		open = $bindable(false),
		title = 'Add line item',
		description = 'Link a catalog product or enter a custom line.',
		submitLabel = 'Add line',
		triggerLabel = 'Add line item',
		class: className,
		trigger,
		onValidSubmit
	}: LineItemFormDrawerProps = $props();
</script>

<Drawer.Root bind:open direction="bottom" shouldScaleBackground={false}>
	{#if trigger}
		<Drawer.Trigger>
			{@render trigger()}
		</Drawer.Trigger>
	{:else}
		<Drawer.Trigger>
			<Button type="button" size="sm">{triggerLabel}</Button>
		</Drawer.Trigger>
	{/if}

	<Drawer.Content class={cn('mx-auto w-full max-w-lg', className)}>
		<Drawer.Header class="text-left">
			<Drawer.Title>{title}</Drawer.Title>
			<Drawer.Description>{description}</Drawer.Description>
		</Drawer.Header>
		<div class="overflow-y-auto px-4 pb-2">
			<LineItemForm {form} {products} {submitLabel} {onValidSubmit} />
		</div>
		<Drawer.Footer class="pt-0">
			<Drawer.Close>
				<Button type="button" variant="outline">Cancel</Button>
			</Drawer.Close>
		</Drawer.Footer>
	</Drawer.Content>
</Drawer.Root>

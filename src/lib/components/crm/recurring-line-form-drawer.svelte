<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { CatalogProductOption } from '$lib/schemas/line-item.js';
	import type { RecurringLineFormData } from '$lib/schemas/recurring-invoice.js';
	import * as Drawer from '$lib/components/ui/drawer/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import RecurringLineForm from './recurring-line-form.svelte';
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	export interface RecurringLineFormDrawerProps {
		form: SuperForm<RecurringLineFormData>;
		open?: boolean;
		products?: CatalogProductOption[];
		submitLabel?: string;
		triggerLabel?: string;
		title?: string;
		description?: string;
		class?: string;
		trigger?: Snippet;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		open = $bindable(false),
		products = [],
		submitLabel = 'Add line',
		triggerLabel = 'Add line',
		title = 'Add schedule line',
		description = 'Lines copy into each generated invoice snapshot.',
		class: className,
		trigger,
		onValidSubmit
	}: RecurringLineFormDrawerProps = $props();
</script>

<Drawer.Root bind:open direction="bottom" shouldScaleBackground={false}>
	{#if trigger}
		<Drawer.Trigger>
			{@render trigger()}
		</Drawer.Trigger>
	{:else}
		<Drawer.Trigger>
			{#snippet child({ props })}
				<Button type="button" size="sm" variant="outline" {...props}>{triggerLabel}</Button>
			{/snippet}
		</Drawer.Trigger>
	{/if}

	<Drawer.Content class={cn('mx-auto w-full max-w-lg', className)}>
		<Drawer.Header class="text-left">
			<Drawer.Title>{title}</Drawer.Title>
			<Drawer.Description>{description}</Drawer.Description>
		</Drawer.Header>
		<div class="overflow-y-auto px-4 pb-2">
			<RecurringLineForm {form} {products} {submitLabel} {onValidSubmit} class="max-w-none" />
		</div>
		<Drawer.Footer class="pt-0">
			<Drawer.Close>
				<Button type="button" variant="outline">Cancel</Button>
			</Drawer.Close>
		</Drawer.Footer>
	</Drawer.Content>
</Drawer.Root>

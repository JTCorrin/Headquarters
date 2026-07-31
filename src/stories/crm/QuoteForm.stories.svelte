<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import QuoteFormDrawer from '$lib/components/crm/quote-form-drawer.svelte';

	const { Story } = defineMeta({
		title: 'Headquarters/QuoteForm',
		component: QuoteFormDrawer,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' }
	});
</script>

<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { quoteFormSchema } from '$lib/schemas/quote.js';

	const data = defaults(
		{
			clientName: 'Northwind',
			title: 'Q2 retainer',
			currency: 'GBP',
			status: 'draft'
		},
		zod4(quoteFormSchema)
	);

	const form = superForm(data, {
		validators: zod4(quoteFormSchema),
		SPA: true,
		warnings: { duplicateId: false },
		resetForm: false
	});

	let open = $state(true);
</script>

<Story name="Drawer">
	{#snippet template()}
		<div class="bg-background flex h-[640px] items-start justify-center p-8">
			<QuoteFormDrawer bind:open {form} />
		</div>
	{/snippet}
</Story>

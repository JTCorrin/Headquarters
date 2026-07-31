<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import QuoteDetailPage from '$lib/components/crm/quote-detail-page.svelte';

	const catalog = [
		{ id: 'p1', sku: 'RET-M', name: 'Monthly retainer', unitPrice: '4200.00' },
		{ id: 'p2', sku: 'IMP-D', name: 'Implementation day', unitPrice: '950.00' },
		{ id: 'p3', sku: 'SUP-H', name: 'Support hour', unitPrice: '120.00' }
	];

	const { Story } = defineMeta({
		title: 'Headquarters/Pages/QuoteDetail',
		component: QuoteDetailPage,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' }
	});
</script>

<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { quoteFormSchema } from '$lib/schemas/quote.js';
	import { lineItemFormSchema } from '$lib/schemas/line-item.js';
	import type { LineItemRow } from '$lib/components/crm/line-items-table.svelte';
	import type { TimelineEvent } from '$lib/components/crm/timeline.svelte';
	import { navGroupsWithActive } from './story-fixtures.js';

	const quoteData = defaults(
		{
			clientName: 'Northwind',
			title: 'Q2 retainer',
			currency: 'GBP',
			status: 'draft'
		},
		zod4(quoteFormSchema)
	);

	const quoteForm = superForm(quoteData, {
		validators: zod4(quoteFormSchema),
		SPA: true,
		warnings: { duplicateId: false },
		resetForm: false
	});

	let lines = $state<LineItemRow[]>([
		{
			id: 'l1',
			productSku: 'RET-M',
			description: 'Monthly retainer',
			qty: '1',
			unitPrice: '4200.00',
			total: '4200.00'
		}
	]);
	let lineDrawerOpen = $state(false);
	let status = $state('Draft');
	let timelineEvents = $state<TimelineEvent[]>([
		{
			id: 'q1',
			kind: 'status',
			title: 'Draft created',
			occurredAt: 'Mar 10 · 09:00',
			actor: 'Joe'
		},
		{
			id: 'q2',
			kind: 'email',
			title: 'Quote sent to Ava',
			body: 'Q-0142 · Q2 retainer',
			occurredAt: 'Mar 12 · 14:20',
			actor: 'Joe'
		},
		{
			id: 'q3',
			kind: 'note',
			title: 'Chase scheduled',
			body: 'Follow up Friday if no reply',
			occurredAt: 'Mar 14 · 11:05',
			actor: 'Maya'
		}
	]);

	function prependEvent(partial: Omit<TimelineEvent, 'id' | 'occurredAt'> & { occurredAt?: string }) {
		timelineEvents = [
			{
				id: crypto.randomUUID(),
				occurredAt: partial.occurredAt ?? 'Just now',
				...partial
			},
			...timelineEvents
		];
	}

	const lineData = defaults(
		{ productId: '', description: '', qty: '1', unitPrice: '' },
		zod4(lineItemFormSchema)
	);

	const lineForm = superForm(lineData, {
		validators: zod4(lineItemFormSchema),
		SPA: true,
		warnings: { duplicateId: false },
		resetForm: true,
		onUpdate({ form }) {
			if (!form.valid) return;
			const d = form.data;
			const product = catalog.find((p) => p.id === d.productId);
			const qty = Number(d.qty) || 0;
			const unit = Number(d.unitPrice) || 0;
			lines = [
				...lines,
				{
					id: crypto.randomUUID(),
					productSku: product?.sku,
					description: d.description,
					qty: d.qty,
					unitPrice: d.unitPrice,
					total: (qty * unit).toFixed(2)
				}
			];
			lineDrawerOpen = false;
		}
	});
</script>

<Story name="Default">
	{#snippet template()}
		<div class="h-screen">
			<QuoteDetailPage
				orgName="Acme Org"
				navGroups={navGroupsWithActive('Quotes')}
				title="Q-0142 · Q2 retainer"
				{status}
				{quoteForm}
				{lineForm}
				products={catalog}
				{timelineEvents}
				bind:lines
				bind:lineDrawerOpen
				onRemoveLine={(id) => {
					lines = lines.filter((row) => row.id !== id);
				}}
				onSend={() => {
					status = 'Sent';
					prependEvent({
						kind: 'email',
						title: 'Quote sent',
						body: 'Emailed to Ava at Northwind',
						actor: 'You'
					});
				}}
				onChase={() => {
					prependEvent({
						kind: 'note',
						title: 'Chase sent',
						body: 'Friendly follow-up on outstanding quote',
						actor: 'You'
					});
				}}
				onConvert={() => {
					status = 'Accepted';
					prependEvent({
						kind: 'status',
						title: 'Converted to invoice',
						body: 'Draft INV created from Q-0142',
						actor: 'You'
					});
				}}
			/>
		</div>
	{/snippet}
</Story>

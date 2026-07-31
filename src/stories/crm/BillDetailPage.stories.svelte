<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import BillDetailPage from '$lib/components/crm/bill-detail-page.svelte';

	const catalog = [
		{ id: 'p1', sku: 'SAAS-M', name: 'SaaS seat (monthly)', unitPrice: '18.00' },
		{ id: 'p2', sku: 'HOST-M', name: 'Hosting (monthly)', unitPrice: '120.00' },
		{ id: 'p3', sku: 'SUP-H', name: 'Support hour', unitPrice: '120.00' }
	];

	const { Story } = defineMeta({
		title: 'Headquarters/Pages/BillDetail',
		component: BillDetailPage,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' }
	});
</script>

<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { billFormSchema } from '$lib/schemas/bill.js';
	import { lineItemFormSchema } from '$lib/schemas/line-item.js';
	import type { LineItemRow } from '$lib/components/crm/line-items-table.svelte';
	import type { TimelineEvent } from '$lib/components/crm/timeline.svelte';
	import { navGroupsWithActive } from './story-fixtures.js';

	const billData = defaults(
		{
			vendorName: 'Figma',
			number: 'BILL-0141',
			currency: 'GBP',
			dueOn: '2026-03-20',
			status: 'received'
		},
		zod4(billFormSchema)
	);

	const billForm = superForm(billData, {
		validators: zod4(billFormSchema),
		SPA: true,
		resetForm: false
	});

	let lines = $state<LineItemRow[]>([
		{
			id: 'l1',
			productSku: 'SAAS-M',
			description: 'Figma Professional · 10 seats',
			qty: '10',
			unitPrice: '18.00',
			total: '180.00'
		}
	]);
	let lineDrawerOpen = $state(false);
	let status = $state('Received');
	let timelineEvents = $state<TimelineEvent[]>([
		{
			id: 'b1',
			kind: 'document',
			title: 'Bill received from Figma',
			occurredAt: 'Mar 1 · 09:12',
			actor: 'System'
		},
		{
			id: 'b2',
			kind: 'note',
			title: 'Matched to Design ops budget',
			occurredAt: 'Mar 1 · 10:40',
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
			<BillDetailPage
				orgName="Acme Org"
				navGroups={navGroupsWithActive('Bills')}
				title="BILL-0141 · Figma"
				{status}
				{billForm}
				{lineForm}
				products={catalog}
				{timelineEvents}
				bind:lines
				bind:lineDrawerOpen
				onRemoveLine={(id) => {
					lines = lines.filter((row) => row.id !== id);
				}}
				onSchedule={() => {
					status = 'Scheduled';
					prependEvent({
						kind: 'status',
						title: 'Payment scheduled',
						body: 'Bank transfer · due Mar 20',
						actor: 'You'
					});
				}}
				onRecordPayment={() => {
					status = 'Part paid';
					prependEvent({
						kind: 'payment',
						title: 'Outbound payment recorded',
						body: 'Storybook mock — £90 of £180',
						actor: 'You'
					});
				}}
				onMarkPaid={() => {
					status = 'Paid';
					prependEvent({
						kind: 'payment',
						title: 'Bill marked paid',
						body: '£180 · Figma',
						actor: 'You'
					});
				}}
			/>
		</div>
	{/snippet}
</Story>

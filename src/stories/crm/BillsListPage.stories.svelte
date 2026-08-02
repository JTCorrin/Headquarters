<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import BillsListPage from '$lib/components/crm/bills-list-page.svelte';
	import { navGroupsWithActive } from './story-fixtures.js';

	const VENDOR_ID = 'cccccccc-cccc-4ddd-8eee-ffffffffffff';

	const rows = [
		{
			id: '1',
			number: 'BILL-0140',
			vendor: 'Cloudflare',
			total: '£42.00',
			status: 'Paid',
			dueOn: '2026-03-01'
		},
		{
			id: '2',
			number: 'BILL-0141',
			vendor: 'Figma',
			total: '£180.00',
			status: 'Received',
			dueOn: '2026-03-20'
		},
		{
			id: '3',
			number: 'BILL-0142',
			vendor: 'AWS',
			total: '£1,240.00',
			status: 'Overdue',
			dueOn: '2026-02-28'
		},
		{
			id: '4',
			number: 'BILL-0143',
			vendor: 'Linear',
			total: '£96.00',
			status: 'Scheduled',
			dueOn: '2026-04-01'
		},
		{
			id: '5',
			number: 'BILL-0144',
			vendor: 'Notion',
			total: '£120.00',
			status: 'Draft',
			dueOn: '2026-04-15'
		},
		{
			id: '6',
			number: 'BILL-0145',
			vendor: 'Vercel',
			total: '£60.00',
			status: 'Received',
			dueOn: '2026-04-10'
		}
	];

	const { Story } = defineMeta({
		title: 'Headquarters/Pages/BillsList',
		component: BillsListPage,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' },
		args: {
			orgName: 'Acme Org',
			navGroups: navGroupsWithActive('Bills'),
			rows,
			vendorOptions: [
				{ id: VENDOR_ID, name: 'Cloudflare', defaultCurrency: 'GBP' },
				{ id: 'dddddddd-dddd-4eee-8fff-000000000001', name: 'Figma', defaultCurrency: 'GBP' }
			]
		}
	});
</script>

<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { billFormSchema } from '$lib/schemas/bill.js';

	const data = defaults(
		{
			vendorId: VENDOR_ID,
			vendorName: 'Cloudflare',
			number: '',
			internalReference: '',
			currency: 'GBP',
			issueOn: '',
			receivedOn: '2026-03-01',
			dueOn: '2026-03-31',
			notes: '',
			status: 'draft'
		},
		zod4(billFormSchema)
	);

	const form = superForm(data, {
		validators: zod4(billFormSchema),
		SPA: true,
		warnings: { duplicateId: false },
		resetForm: false
	});
</script>

<Story name="Default">
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/bills-list-page.svelte').BillsListPageProps} */ (
				args
			)}
		<div class="h-screen">
			<BillsListPage {...props} {form} />
		</div>
	{/snippet}
</Story>

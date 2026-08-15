<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ClientProfilePage from '$lib/components/crm/client-profile-page.svelte';
	import {
		navGroupsWithActive,
		sampleDocuments,
		sampleEmailMessages,
		sampleTimelineEvents
	} from './story-fixtures.js';

	const { Story } = defineMeta({
		title: 'Headquarters/Pages/ClientProfile',
		component: ClientProfilePage,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' },
		args: {
			orgName: 'Acme Org',
			navGroups: navGroupsWithActive('Clients'),
			breadcrumb: 'Clients / Northwind',
			title: 'Northwind',
			status: 'Client',
			subtitle: 'Owner Joe · Tags: retainer, EU',
			companyFields: [
				{ label: 'Website', value: 'northwind.com' },
				{ label: 'Industry', value: 'Wholesale / logistics' },
				{ label: 'Timezone', value: 'Europe/London' }
			],
			billingFields: [
				{ label: 'Billing address', value: '12 Harbour Rd, London' },
				{ label: 'Currency', value: 'GBP' },
				{ label: 'Payment terms', value: 'Net 30' }
			],
			relatedContacts: [
				{
					id: '1',
					name: 'Ava Chen',
					role: 'Primary',
					email: 'ava@northwind.com'
				},
				{
					id: '2',
					name: 'Northwind Billing',
					role: 'Billing',
					email: 'billing@northwind.com'
				}
			],
			emailMessages: sampleEmailMessages,
			documents: sampleDocuments,
			moneyItems: [
				{
					id: 'm1',
					kind: 'quote',
					label: 'Q-0140 · Annual',
					amount: '£18,000.00',
					status: 'Accepted',
					date: 'Jan 8'
				},
				{
					id: 'm2',
					kind: 'invoice',
					label: 'INV-0875',
					amount: '£4,500.00',
					status: 'Paid',
					date: 'Feb 1'
				},
				{
					id: 'm3',
					kind: 'payment',
					label: 'Bank · INV-0875',
					amount: '£4,500.00',
					status: 'Matched',
					date: 'Feb 3'
				}
			],
			projects: [
				{
					id: 'p1',
					name: 'Q2 retainer delivery',
					status: 'Active',
					owner: 'Joe',
					cardCount: 8,
					updatedAt: 'Today'
				},
				{
					id: 'p2',
					name: 'Warehouse rollout',
					status: 'Planning',
					owner: 'Maya',
					cardCount: 12,
					updatedAt: 'Mon'
				}
			]
		}
	});
</script>

<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { documentFormSchema } from '$lib/schemas/document.js';
	import { clientFormSchema } from '$lib/schemas/client.js';
	import type { EntityDocument } from '$lib/components/crm/entity-documents.svelte';
	import type { TimelineEvent } from '$lib/components/crm/timeline.svelte';

	let documents = $state<EntityDocument[]>([...sampleDocuments]);
	let documentDrawerOpen = $state(false);
	let editDrawerOpen = $state(false);
	let timelineEvents = $state<TimelineEvent[]>([...sampleTimelineEvents]);

	const documentData = defaults(
		{ name: '', category: 'other', notes: '' },
		zod4(documentFormSchema)
	);

	const documentForm = superForm(documentData, {
		validators: zod4(documentFormSchema),
		SPA: true,
		warnings: { duplicateId: false },
		resetForm: true,
		onUpdate({ form }) {
			if (!form.valid) return;
			const d = form.data;
			documents = [
				{
					id: crypto.randomUUID(),
					name: d.name,
					category: d.category,
					sizeLabel: '—',
					uploadedAt: 'Just now',
					uploadedBy: 'You'
				},
				...documents
			];
			documentDrawerOpen = false;
		}
	});

	const clientData = defaults(
		{
			name: 'Northwind',
			status: 'active',
			websiteUrl: 'https://northwind.com',
			industry: 'Wholesale / logistics',
			primaryEmail: 'billing@northwind.com',
			emailDomain: 'northwind.com',
			phone: '',
			taxIdentifier: '',
		taxExempt: false,
			registrationNumber: '',
			defaultCurrency: 'GBP',
			paymentTermsDays: '30',
			renewalOn: '',
			notes: ''
		},
		zod4(clientFormSchema)
	);

	const clientForm = superForm(clientData, {
		validators: zod4(clientFormSchema),
		SPA: true,
		warnings: { duplicateId: false },
		applyAction: false,
		resetForm: false,
		onUpdate({ form }) {
			if (!form.valid) return;
			editDrawerOpen = false;
		}
	});
</script>

<Story name="Default">
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/client-profile-page.svelte').ClientProfilePageProps} */ (
				args
			)}
		<div class="h-screen">
			<ClientProfilePage
				{...props}
				{documentForm}
				{clientForm}
				bind:timelineEvents
				bind:documents
				bind:documentDrawerOpen
				bind:editDrawerOpen
			/>
		</div>
	{/snippet}
</Story>

<Story name="Conflict412">
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/client-profile-page.svelte').ClientProfilePageProps} */ (
				args
			)}
		<div class="h-screen">
			<ClientProfilePage
				{...props}
				{documentForm}
				{clientForm}
				bind:timelineEvents
				bind:documents
				bind:documentDrawerOpen
				bind:editDrawerOpen
				viewState={{
					kind: 'conflict',
					message: 'Client version does not match If-Match'
				}}
			/>
		</div>
	{/snippet}
</Story>

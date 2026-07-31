<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ContactProfilePage from '$lib/components/crm/contact-profile-page.svelte';
	import {
		navGroupsWithActive,
		sampleDocuments,
		sampleEmailMessages,
		sampleTimelineEvents
	} from './story-fixtures.js';

	const { Story } = defineMeta({
		title: 'Headquarters/Pages/ContactProfile',
		component: ContactProfilePage,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' },
		args: {
			orgName: 'Acme Org',
			navGroups: navGroupsWithActive('Contacts'),
			breadcrumb: 'Contacts / Ava Chen',
			title: 'Ava Chen',
			status: 'Client',
			subtitle: 'Primary at Northwind · Owner Joe · Tags: retainer, EU',
			contactFields: [
				{ label: 'Email', value: 'ava@northwind.com' },
				{ label: 'Phone', value: '+44 7700 900123' },
				{ label: 'Title', value: 'Head of Operations' },
				{ label: 'Owner', value: 'Joe' }
			],
			companyFields: [
				{ label: 'Company', value: 'Northwind' },
				{ label: 'Website', value: 'northwind.com' },
				{ label: 'Industry', value: 'Wholesale / logistics' },
				{ label: 'Billing address', value: '12 Harbour Rd, London' }
			],
			emailMessages: sampleEmailMessages,
			documents: sampleDocuments,
			moneyItems: [
				{
					id: 'm1',
					kind: 'quote',
					label: 'Q-0142 · Q2 retainer',
					amount: '£4,200.00',
					status: 'Sent',
					date: 'Mar 12'
				},
				{
					id: 'm2',
					kind: 'invoice',
					label: 'INV-0881',
					amount: '£4,200.00',
					status: 'Partial',
					date: 'Mar 1'
				},
				{
					id: 'm3',
					kind: 'payment',
					label: 'Stripe · INV-0881',
					amount: '£2,000.00',
					status: 'Matched',
					date: 'Mar 18'
				}
			]
		}
	});
</script>

<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { documentFormSchema } from '$lib/schemas/document.js';
	import type { EntityDocument } from '$lib/components/crm/entity-documents.svelte';
	import type { TimelineEvent } from '$lib/components/crm/timeline.svelte';

	let documents = $state<EntityDocument[]>([...sampleDocuments]);
	let documentDrawerOpen = $state(false);
	let timelineEvents = $state<TimelineEvent[]>([...sampleTimelineEvents]);

	const documentData = defaults(
		{ name: '', category: 'other', notes: '' },
		zod4(documentFormSchema)
	);

	const documentForm = superForm(documentData, {
		validators: zod4(documentFormSchema),
		SPA: true,
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
</script>

<Story name="Default">
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/contact-profile-page.svelte').ContactProfilePageProps} */ (
				args
			)}
		<div class="h-screen">
			<ContactProfilePage
				{...props}
				{documentForm}
				bind:timelineEvents
				bind:documents
				bind:documentDrawerOpen
			/>
		</div>
	{/snippet}
</Story>

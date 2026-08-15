<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { clientFormSchema } from '$lib/schemas/client.js';
	import ClientsListPage from './clients-list-page.svelte';
	import type { ClientRow } from './clients-columns.js';
	import type { AppNavGroup } from './app-nav.svelte';
	import type { ResourceViewState } from './resource-state-banner.svelte';

	export interface ClientsListPageStoryHostProps {
		orgName: string;
		navGroups: AppNavGroup[];
		rows?: ClientRow[];
		viewState?: ResourceViewState;
		class?: string;
		onReload?: () => void;
	}

	let {
		orgName,
		navGroups,
		rows = [],
		viewState = { kind: 'ready' },
		class: className,
		onReload
	}: ClientsListPageStoryHostProps = $props();

	let drawerOpen = $state(false);

	const clientForm = superForm(
		defaults(
			{
				name: '',
				status: 'active',
				websiteUrl: '',
				industry: '',
				primaryEmail: '',
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
		),
		{
			validators: zod4(clientFormSchema),
			SPA: true,
		warnings: { duplicateId: false },
			applyAction: false,
			resetForm: false
		}
	);
</script>

<ClientsListPage
	{orgName}
	{navGroups}
	{rows}
	{clientForm}
	bind:drawerOpen
	{viewState}
	{onReload}
	class={className}
/>

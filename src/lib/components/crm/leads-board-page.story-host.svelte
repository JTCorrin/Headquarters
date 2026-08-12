<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { leadFormSchema } from '$lib/schemas/lead.js';
	import LeadsBoardPage from './leads-board-page.svelte';
	import type { LeadCard } from './leads-board.svelte';
	import type { AppNavGroup } from './app-nav.svelte';
	import type { ResourceViewState } from './resource-state-banner.svelte';

	export interface LeadsBoardPageStoryHostProps {
		orgName: string;
		navGroups: AppNavGroup[];
		leads?: LeadCard[];
		viewState?: ResourceViewState;
		class?: string;
		onSelectLead?: (id: string) => void;
		onReload?: () => void;
	}

	let {
		orgName,
		navGroups,
		leads = [],
		viewState = { kind: 'ready' },
		class: className,
		onSelectLead,
		onReload
	}: LeadsBoardPageStoryHostProps = $props();

	let drawerOpen = $state(false);

	const leadForm = superForm(
		defaults(
			{
				name: '',
				companyName: '',
				primaryEmail: '',
				clientId: '',
				stage: 'new',
				valueAmount: '',
				currency: 'GBP',
				probabilityPercent: '',
				source: '',
				expectedCloseOn: '',
				lostReason: '',
				notes: ''
			},
			zod4(leadFormSchema)
		),
		{
			validators: zod4(leadFormSchema),
			SPA: true,
			warnings: { duplicateId: false },
			applyAction: false,
			resetForm: false
		}
	);
</script>

<LeadsBoardPage
	{orgName}
	{navGroups}
	{leads}
	{leadForm}
	orgCurrency="GBP"
	bind:drawerOpen
	{viewState}
	{onSelectLead}
	{onReload}
	class={className}
/>

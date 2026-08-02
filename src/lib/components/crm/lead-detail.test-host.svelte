<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { centsToAmountString } from '$lib/money.js';
	import {
		convertLeadFormSchema,
		leadFormSchema,
		type LeadResource
	} from '$lib/schemas/lead.js';
	import LeadDetailPage, { type LeadConvertResult } from './lead-detail-page.svelte';
	import type { ResourceViewState } from './resource-state-banner.svelte';

	export interface LeadDetailTestHostProps {
		lead?: LeadResource | null;
		viewState?: ResourceViewState;
		lastConvertResult?: LeadConvertResult | null;
		onConvert?: () => void;
		onReload?: () => void;
	}

	let {
		lead = null,
		viewState = { kind: 'ready' },
		lastConvertResult = null,
		onConvert,
		onReload
	}: LeadDetailTestHostProps = $props();

	let convertOpen = $state(false);

	const leadForm = superForm(
		defaults(
			{
				name: lead?.name ?? '',
				companyName: lead?.company_name ?? '',
				clientId: lead?.client_id ?? '',
				stage: lead?.stage === 'won' ? 'proposal' : (lead?.stage ?? 'new'),
				valueAmount: centsToAmountString(lead?.value_cents),
				currency: lead?.currency ?? 'GBP',
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

	const convertForm = superForm(
		defaults({ clientName: lead?.name ?? '', clientStatus: 'active' }, zod4(convertLeadFormSchema)),
		{
			validators: zod4(convertLeadFormSchema),
			SPA: true,
		warnings: { duplicateId: false },
			applyAction: false,
			resetForm: false
		}
	);

	const navGroups = [
		{
			items: [
				{ label: 'Dashboard', href: '/', active: false },
				{ label: 'Leads', href: '/leads', active: true }
			]
		}
	];
</script>

<LeadDetailPage
	orgName="Acme Org"
	{navGroups}
	{lead}
	{leadForm}
	{convertForm}
	bind:convertOpen
	{viewState}
	{lastConvertResult}
	{onConvert}
	{onReload}
/>

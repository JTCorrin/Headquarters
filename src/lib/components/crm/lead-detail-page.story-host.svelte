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
	import type { AppNavGroup } from './app-nav.svelte';
	import type { ResourceViewState } from './resource-state-banner.svelte';

	export interface LeadDetailPageStoryHostProps {
		orgName: string;
		navGroups: AppNavGroup[];
		lead?: LeadResource | null;
		viewState?: ResourceViewState;
		lastConvertResult?: LeadConvertResult | null;
		converting?: boolean;
		class?: string;
		onConvert?: () => void;
		onReload?: () => void;
	}

	let {
		orgName,
		navGroups,
		lead = null,
		viewState = { kind: 'ready' },
		lastConvertResult = null,
		converting = false,
		class: className,
		onConvert,
		onReload
	}: LeadDetailPageStoryHostProps = $props();

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
				probabilityPercent:
					lead?.probability_percent != null ? String(lead.probability_percent) : '',
				source: lead?.source ?? '',
				expectedCloseOn: lead?.expected_close_on ?? '',
				lostReason: lead?.lost_reason ?? '',
				notes: lead?.notes ?? ''
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
		defaults(
			{ clientName: lead?.name ?? lead?.company_name ?? '', clientStatus: 'active' },
			zod4(convertLeadFormSchema)
		),
		{
			validators: zod4(convertLeadFormSchema),
			SPA: true,
		warnings: { duplicateId: false },
			applyAction: false,
			resetForm: false
		}
	);
</script>

<LeadDetailPage
	{orgName}
	{navGroups}
	{lead}
	{leadForm}
	{convertForm}
	bind:convertOpen
	{viewState}
	{lastConvertResult}
	{converting}
	{onConvert}
	{onReload}
	class={className}
/>

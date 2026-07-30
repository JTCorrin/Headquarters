<script lang="ts">
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import ProfileHeader from './profile-header.svelte';
	import ProfileTabs from './profile-tabs.svelte';
	import InfoCard, { type InfoCardField } from './info-card.svelte';
	import Timeline, { type TimelineEvent } from './timeline.svelte';
	import EntityEmailInbox, { type EmailMessage } from './entity-email-inbox.svelte';
	import MoneySummary, { type MoneySummaryItem } from './money-summary.svelte';
	import StatusBadge from './status-badge.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface RelatedContact {
		id: string;
		name: string;
		role: string;
		email: string;
	}

	export interface ClientProfilePageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		breadcrumb: string;
		title: string;
		status: string;
		subtitle?: string;
		companyFields: InfoCardField[];
		billingFields?: InfoCardField[];
		relatedContacts?: RelatedContact[];
		timelineEvents: TimelineEvent[];
		emailMessages?: EmailMessage[];
		moneyItems?: MoneySummaryItem[];
		class?: string;
	}

	let {
		orgName,
		navGroups,
		breadcrumb,
		title,
		status,
		subtitle,
		companyFields,
		billingFields = [],
		relatedContacts = [],
		timelineEvents,
		emailMessages = [],
		moneyItems = [],
		class: className
	}: ClientProfilePageProps = $props();

	const tabs = [
		{ id: 'details', label: 'Details' },
		{ id: 'email', label: 'Email' },
		{ id: 'documents', label: 'Documents' },
		{ id: 'money', label: 'Money' }
	];
</script>

<div class={cn('bg-background text-foreground flex h-full min-h-[720px]', className)}>
	<AppNav {orgName} groups={navGroups} class="shrink-0" />

	<main class="flex min-h-0 min-w-0 flex-1 flex-col">
		<div class="flex min-h-0 flex-1 flex-col gap-6 px-6 py-6 md:px-8">
			<div class="shrink-0">
				<ProfileHeader {breadcrumb} {title} {status} {subtitle}>
					{#snippet actions()}
						<Button variant="outline" size="sm">Email</Button>
						<Button variant="outline" size="sm">New quote</Button>
						<Button size="sm">Edit</Button>
					{/snippet}
				</ProfileHeader>
			</div>

			<ProfileTabs {tabs}>
				{#snippet children({ active })}
					{#if active === 'details'}
						<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
							<div class="space-y-4">
								<InfoCard title="Company" fields={companyFields} />
								{#if billingFields.length}
									<InfoCard title="Billing" fields={billingFields} />
								{/if}
								{#if relatedContacts.length}
									<InfoCard title="Contacts">
										<div class="space-y-3">
											{#each relatedContacts as person (person.id)}
												<div class="flex items-start justify-between gap-3">
													<div class="min-w-0">
														<p class="text-sm font-medium">{person.name}</p>
														<p class="text-muted-foreground truncate text-xs">{person.email}</p>
													</div>
													<StatusBadge status={person.role} />
												</div>
											{/each}
										</div>
									</InfoCard>
								{/if}
							</div>
							<Timeline events={timelineEvents} title="Activity" />
						</div>
					{:else if active === 'email'}
						<EntityEmailInbox messages={emailMessages} class="min-h-0 flex-1" />
					{:else if active === 'documents'}
						<p class="text-muted-foreground text-sm">Documents list UI lands in a later wave.</p>
					{:else}
						<MoneySummary items={moneyItems} />
					{/if}
				{/snippet}
			</ProfileTabs>
		</div>
	</main>
</div>

<script lang="ts">
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import ProfileHeader from './profile-header.svelte';
	import ProfileTabs from './profile-tabs.svelte';
	import InfoCard, { type InfoCardField } from './info-card.svelte';
	import Timeline, { type TimelineEvent } from './timeline.svelte';
	import EntityEmailInbox, { type EmailMessage } from './entity-email-inbox.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface ContactProfilePageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		breadcrumb: string;
		title: string;
		status: string;
		subtitle?: string;
		companyFields: InfoCardField[];
		contactFields: InfoCardField[];
		timelineEvents: TimelineEvent[];
		emailMessages?: EmailMessage[];
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
		contactFields,
		timelineEvents,
		emailMessages = [],
		class: className
	}: ContactProfilePageProps = $props();

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
						<Button variant="outline" size="sm">Add note</Button>
						<Button size="sm">Edit</Button>
					{/snippet}
				</ProfileHeader>
			</div>

			<ProfileTabs {tabs}>
				{#snippet children({ active })}
					{#if active === 'details'}
						<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
							<div class="space-y-4">
								<InfoCard title="Contact" fields={contactFields} />
								<InfoCard title="Company" fields={companyFields} />
							</div>
							<Timeline events={timelineEvents} title="Activity" />
						</div>
					{:else if active === 'email'}
						<EntityEmailInbox messages={emailMessages} class="min-h-0 flex-1" />
					{:else if active === 'documents'}
						<p class="text-muted-foreground text-sm">Documents list UI lands in a later wave.</p>
					{:else}
						<p class="text-muted-foreground text-sm">Quotes / invoices / payments land in a later wave.</p>
					{/if}
				{/snippet}
			</ProfileTabs>
		</div>
	</main>
</div>

<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import type { DocumentFormData } from '$lib/schemas/document.js';
	import type { ClientFormData } from '$lib/schemas/client.js';
	import { type AppNavGroup } from './app-nav.svelte';
	import AppSidebarFrame from './app-sidebar-frame.svelte';
	import ProfileHeader from './profile-header.svelte';
	import ProfileTabs from './profile-tabs.svelte';
	import InfoCard, { type InfoCardField } from './info-card.svelte';
	import Timeline, { type TimelineEvent } from './timeline.svelte';
	import type { TimelineComposerSubmit } from './timeline-composer.svelte';
	import EntityEmailInbox, {
		type EmailMessage,
		type EntityEmailEmptyState
	} from './entity-email-inbox.svelte';
	import DocumentWorkspaceApiHost from './document-workspace-api-host.svelte';
	import EntityDocuments, { type EntityDocument } from './entity-documents.svelte';
	import EntityProjects, { type EntityProject } from './entity-projects.svelte';
	import MoneySummary, { type MoneySummaryItem } from './money-summary.svelte';
	import ClientFormDrawer from './client-form-drawer.svelte';
	import ResourceStateBanner, {
		type ResourceViewState
	} from './resource-state-banner.svelte';
	import StatusBadge from './status-badge.svelte';
	import ContactNameLink from './contact-name-link.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import type { MembershipRole } from '$lib/schemas/organisation.js';

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
		timelineEvents?: TimelineEvent[];
		composerActor?: string;
		emailMessages?: EmailMessage[];
		emailEmptyState?: EntityEmailEmptyState;
		mailboxConnected?: boolean;
		aiProviderConnected?: boolean;
		smtpReady?: boolean;
		role?: MembershipRole;
		mailSettingsHref?: string;
		sharingId?: string | null;
		/** Prefill for new-email To (client primary_email). */
		emailDefaultTo?: string;
		/** Live API workspace — preferred over Storybook mock props. */
		documentsApi?: ApiV1Client;
		documentsEntityId?: string;
		documentsReloadKey?: string | number;
		documents?: EntityDocument[];
		documentForm?: SuperForm<DocumentFormData>;
		documentDrawerOpen?: boolean;
		clientForm?: SuperForm<ClientFormData>;
		editDrawerOpen?: boolean;
		viewState?: ResourceViewState;
		moneyItems?: MoneySummaryItem[];
		projects?: EntityProject[];
		/** Client id for New quote deep-link (`/quotes?client_id=&new=1`). */
		clientId?: string;
		/** When false, omit AppNav (shell already renders it at full window height). */
		showNav?: boolean;
		class?: string;
		onReload?: () => void;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
		onDelete?: () => void;
		onTimelineAdd?: (event: TimelineComposerSubmit) => void | Promise<void>;
		onAddToTimeline?: (payload: { messageId: string }) => void | Promise<void>;
		onSendReply?: (payload: { messageId: string; body: string }) => void | Promise<void>;
		onSendNew?: (payload: { to: string; subject: string; body: string }) => void | Promise<void>;
		onDraftResponse?: (payload: {
			messageId: string;
			tone: 'warm' | 'neutral' | 'firm';
		}) => Promise<{ suggestionId?: string; suggestionText: string }>;
		onDraftCompose?: (payload: {
			tone: 'warm' | 'neutral' | 'firm';
			subject: string;
			to: string;
		}) => Promise<{ suggestionId?: string; suggestionText: string }>;
		onUseSuggestion?: (payload: {
			suggestionId?: string;
			text: string;
		}) => void | Promise<void>;
		onDiscardSuggestion?: (payload: { suggestionId?: string }) => void | Promise<void>;
		/** Override New quote navigation (defaults to quotes create with client preselected). */
		onNewQuote?: () => void;
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
		timelineEvents = $bindable<TimelineEvent[]>([]),
		composerActor = 'You',
		emailMessages = [],
		emailEmptyState = 'no_mailbox',
		mailboxConnected = false,
		aiProviderConnected = false,
		smtpReady = false,
		role = 'member',
		mailSettingsHref = '/settings#mail',
		sharingId = null,
		emailDefaultTo = '',
		documentsApi,
		documentsEntityId,
		documentsReloadKey = 0,
		documents = $bindable<EntityDocument[]>([]),
		documentForm,
		documentDrawerOpen = $bindable(false),
		clientForm,
		editDrawerOpen = $bindable(false),
		viewState = { kind: 'ready' },
		moneyItems = [],
		projects = [],
		clientId,
		showNav = true,
		class: className,
		onReload,
		onValidSubmit,
		onDelete,
		onTimelineAdd,
		onAddToTimeline,
		onSendReply,
		onSendNew,
		onDraftResponse,
		onDraftCompose,
		onUseSuggestion,
		onDiscardSuggestion,
		onNewQuote
	}: ClientProfilePageProps = $props();

	const tabs = [
		{ id: 'details', label: 'Details' },
		{ id: 'email', label: 'Email' },
		{ id: 'documents', label: 'Documents' },
		{ id: 'money', label: 'Money' },
		{ id: 'projects', label: 'Projects' }
	];

	let activeTab = $state('details');
	let composingNew = $state(false);

	const newQuoteHref = $derived(
		clientId ? `/quotes?client_id=${encodeURIComponent(clientId)}&new=1` : '/quotes?new=1'
	);

	function handleEmailClick() {
		activeTab = 'email';
		composingNew = true;
	}

	function handleNewQuoteClick() {
		onNewQuote?.();
	}
</script>

<AppSidebarFrame
	{orgName}
	groups={navGroups}
	{showNav}
	showTrigger={showNav}
	class={cn(
		showNav ? 'h-full min-h-[720px]' : 'min-h-0 flex-1 flex-col',
		className
	)}
>

	<main class="flex min-h-0 min-w-0 flex-1 flex-col">
		<div class="flex min-h-0 flex-1 flex-col gap-6 px-4 py-6 sm:px-6 md:px-8">
			<div class="shrink-0">
				<ProfileHeader {breadcrumb} {title} {status} {subtitle}>
					{#snippet actions()}
						<Button
							type="button"
							variant="outline"
							size="sm"
							data-testid="client-email-action"
							onclick={handleEmailClick}
						>
							Email
						</Button>
						{#if onNewQuote}
							<Button
								type="button"
								variant="outline"
								size="sm"
								data-testid="client-new-quote-action"
								onclick={handleNewQuoteClick}
							>
								New quote
							</Button>
						{:else}
							<Button
								variant="outline"
								size="sm"
								href={newQuoteHref}
								data-testid="client-new-quote-action"
							>
								New quote
							</Button>
						{/if}
						{#if clientForm}
							<ClientFormDrawer
								bind:open={editDrawerOpen}
								form={clientForm}
								title="Edit client"
								description="PATCH with If-Match version — conflicts surface as 412."
								submitLabel="Save client"
								{onValidSubmit}
							>
								{#snippet trigger()}
									<Button type="button" size="sm">Edit</Button>
								{/snippet}
							</ClientFormDrawer>
						{:else}
							<Button size="sm">Edit</Button>
						{/if}
						{#if onDelete}
							<Button
								type="button"
								variant="outline"
								size="sm"
								data-testid="client-delete"
								onclick={() => onDelete?.()}
							>
								Delete
							</Button>
						{/if}
					{/snippet}
				</ProfileHeader>
			</div>

			<ResourceStateBanner state={viewState} {onReload} />

			<ProfileTabs {tabs} bind:value={activeTab}>
				{#snippet children({ active })}
					{#if active === 'details'}
						<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
							<div class="space-y-4">
								<InfoCard title="Company" fields={companyFields} />
								{#if billingFields.length}
									<InfoCard title="Billing" fields={billingFields} />
								{/if}
								<InfoCard title="Contacts">
									<div class="space-y-3" data-testid="client-related-contacts">
										{#each relatedContacts as person (person.id)}
											<div class="flex items-start justify-between gap-3">
												<div class="min-w-0">
													<p class="text-sm font-medium">
														<ContactNameLink id={person.id} name={person.name} />
													</p>
													<p class="text-muted-foreground truncate text-xs">{person.email}</p>
												</div>
												<StatusBadge status={person.role} />
											</div>
										{:else}
											<p class="text-muted-foreground text-sm">
												No people linked to this client yet.
											</p>
										{/each}
									</div>
								</InfoCard>
							</div>
							<Timeline
								bind:events={timelineEvents}
								title="Activity"
								composable
								{composerActor}
								onAdd={onTimelineAdd}
							/>
						</div>
					{:else if active === 'email'}
						<EntityEmailInbox
							messages={emailMessages}
							emptyState={emailEmptyState}
							{mailboxConnected}
							{aiProviderConnected}
							{smtpReady}
							{role}
							{mailSettingsHref}
							{sharingId}
							defaultTo={emailDefaultTo}
							bind:composingNew
							{onAddToTimeline}
							{onSendReply}
							{onSendNew}
							{onDraftResponse}
							{onDraftCompose}
							{onUseSuggestion}
							{onDiscardSuggestion}
							class="min-h-0 flex-1"
						/>
					{:else if active === 'documents'}
						{#if documentsApi && documentsEntityId}
							<DocumentWorkspaceApiHost
								client={documentsApi}
								entityType="client"
								entityId={documentsEntityId}
								reloadKey={documentsReloadKey}
								title="Documents"
								emptyMessage="No documents yet — upload files for this client."
								class="min-h-0 flex-1"
							/>
						{:else if documentForm}
							<EntityDocuments
								{documents}
								form={documentForm}
								bind:drawerOpen={documentDrawerOpen}
								class="min-h-0 flex-1"
							/>
						{:else}
							<p class="text-muted-foreground text-sm">Select a client to browse documents.</p>
						{/if}
					{:else if active === 'money'}
						<MoneySummary items={moneyItems} />
					{:else}
						<EntityProjects {projects} />
					{/if}
				{/snippet}
			</ProfileTabs>
		</div>
	</main>
</AppSidebarFrame>

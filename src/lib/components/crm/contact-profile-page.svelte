<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import type { ContactFormData } from '$lib/schemas/contact.js';
	import type { DocumentFormData } from '$lib/schemas/document.js';
	import type { LeadClientOption } from '$lib/schemas/lead.js';
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
	import ContactFormDrawer from './contact-form-drawer.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import type { MembershipRole } from '$lib/schemas/organisation.js';

	export interface ContactProfilePageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		breadcrumb: string;
		title: string;
		status: string;
		subtitle?: string;
		companyFields: InfoCardField[];
		contactFields: InfoCardField[];
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
		/** Live API workspace — preferred over Storybook mock props. */
		documentsApi?: ApiV1Client;
		documentsEntityId?: string;
		documentsReloadKey?: string | number;
		documents?: EntityDocument[];
		documentForm?: SuperForm<DocumentFormData>;
		documentDrawerOpen?: boolean;
		contactForm?: SuperForm<ContactFormData>;
		clientOptions?: LeadClientOption[];
		editDrawerOpen?: boolean;
		/** When false, omit AppNav (shell already renders it at full window height). */
		showNav?: boolean;
		class?: string;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
		onDelete?: () => void;
		onTimelineAdd?: (event: TimelineComposerSubmit) => void | Promise<void>;
		onAddToTimeline?: (payload: { messageId: string }) => void | Promise<void>;
		onSendReply?: (payload: { messageId: string; body: string }) => void | Promise<void>;
		onDraftResponse?: (payload: {
			messageId: string;
			tone: 'warm' | 'neutral' | 'firm';
		}) => Promise<{ suggestionId?: string; suggestionText: string }>;
		onUseSuggestion?: (payload: {
			suggestionId?: string;
			text: string;
		}) => void | Promise<void>;
		onDiscardSuggestion?: (payload: { suggestionId?: string }) => void | Promise<void>;
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
		documentsApi,
		documentsEntityId,
		documentsReloadKey = 0,
		documents = $bindable<EntityDocument[]>([]),
		documentForm,
		documentDrawerOpen = $bindable(false),
		contactForm,
		clientOptions = [],
		editDrawerOpen = $bindable(false),
		showNav = true,
		class: className,
		onValidSubmit,
		onDelete,
		onTimelineAdd,
		onAddToTimeline,
		onSendReply,
		onDraftResponse,
		onUseSuggestion,
		onDiscardSuggestion
	}: ContactProfilePageProps = $props();

	const tabs = [
		{ id: 'details', label: 'Details' },
		{ id: 'email', label: 'Email' },
		{ id: 'documents', label: 'Documents' }
	];
</script>

<AppSidebarFrame
	{orgName}
	groups={navGroups}
	{showNav}
	showTrigger={showNav}
	class={cn(
		showNav ? 'h-full min-h-svh' : 'min-h-0 flex-1 flex-col',
		className
	)}
>

	<main class="flex min-h-0 min-w-0 flex-1 flex-col">
		<div class="flex min-h-0 flex-1 flex-col gap-6 px-4 py-6 sm:px-6 md:px-8">
			<div class="shrink-0">
				<ProfileHeader {breadcrumb} {title} {status} {subtitle}>
					{#snippet actions()}
						<Button variant="outline" size="sm">Email</Button>
						<Button variant="outline" size="sm">Add note</Button>
						{#if contactForm}
							<ContactFormDrawer
								bind:open={editDrawerOpen}
								form={contactForm}
								{clientOptions}
								title="Edit contact"
								description="Update this contact. Save uses If-Match versioning."
								submitLabel="Save contact"
								{onValidSubmit}
							>
								{#snippet trigger()}
									<Button type="button" size="sm" data-testid="contact-edit">Edit</Button>
								{/snippet}
							</ContactFormDrawer>
						{:else}
							<Button size="sm" data-testid="contact-edit">Edit</Button>
						{/if}
						{#if onDelete}
							<Button
								type="button"
								variant="outline"
								size="sm"
								data-testid="contact-delete"
								onclick={() => onDelete?.()}
							>
								Delete
							</Button>
						{/if}
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
							{onAddToTimeline}
							{onSendReply}
							{onDraftResponse}
							{onUseSuggestion}
							{onDiscardSuggestion}
							class="min-h-0 flex-1"
						/>
					{:else}
						{#if documentsApi && documentsEntityId}
							<DocumentWorkspaceApiHost
								client={documentsApi}
								entityType="contact"
								entityId={documentsEntityId}
								reloadKey={documentsReloadKey}
								title="Documents"
								emptyMessage="No documents yet — upload files for this contact."
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
							<p class="text-muted-foreground text-sm">Select a contact to browse documents.</p>
						{/if}
					{/if}
				{/snippet}
			</ProfileTabs>
		</div>
	</main>
</AppSidebarFrame>

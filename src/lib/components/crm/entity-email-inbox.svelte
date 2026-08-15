<script lang="ts">
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import { sanitizeEmailHtml } from '$lib/crm/sanitize-email-html.js';
	import type { MembershipRole } from '$lib/schemas/organisation.js';
	import { draftResponseGateCopy } from '$lib/schemas/integration.js';
	import { cn } from '$lib/utils.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte.js';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import AiAssistAction from './ai-assist-action.svelte';
	import type { AiSuggestionStatus } from './ai-suggestion-panel.svelte';

	export interface EmailMessage {
		id: string;
		direction: 'in' | 'out';
		from: string;
		/** Raw sender address (always present for inbound). */
		fromAddress: string;
		/** Display name when the provider supplied one. */
		fromName?: string | null;
		to: string;
		subject: string;
		preview: string;
		body: string;
		bodyHtml?: string | null;
		attachments?: Array<{ filename: string; contentType: string; inline?: boolean }>;
		occurredAt: string;
		unread?: boolean;
	}

	/** Wave A empty states — personal inbox uses `empty_inbox`; entity tabs use `no_matches`. */
	export type EntityEmailEmptyState =
		| 'no_mailbox'
		| 'no_matches'
		| 'empty_inbox'
		| 'teammate_nothing_shared';

	export type DraftTone = 'warm' | 'neutral' | 'firm';

	export interface EntityEmailInboxProps {
		messages: EmailMessage[];
		selectedId?: string;
		/** @deprecated Prefer `emptyState` for Wave A stories. */
		emptyMessage?: string;
		emptyState?: EntityEmailEmptyState;
		mailboxConnected?: boolean;
		aiProviderConnected?: boolean;
		smtpReady?: boolean;
		role?: MembershipRole;
		mailSettingsHref?: string;
		integrationsHref?: string;
		/** Forward stays hidden until a real forward path exists. */
		showForward?: boolean;
		/** Optional mock delay (ms) for Draft response in Storybook. */
		draftDelayMs?: number;
		/** When true, show Add to timeline on the reading pane. */
		canAddToTimeline?: boolean;
		sharingId?: string | null;
		/** When true, show Create lead on inbound messages (personal inbox). */
		canCreateLead?: boolean;
		class?: string;
		onSendReply?: (payload: { messageId: string; body: string }) => void | Promise<void>;
		onAddToTimeline?: (payload: { messageId: string }) => void | Promise<void>;
		onCreateLead?: (payload: {
			messageId: string;
			fromAddress: string;
			fromName: string | null;
			subject: string;
		}) => void;
		onDraftResponse?: (payload: {
			messageId: string;
			tone: DraftTone;
		}) => Promise<{ suggestionId?: string; suggestionText: string }>;
		onUseSuggestion?: (payload: {
			suggestionId?: string;
			text: string;
		}) => void | Promise<void>;
		onDiscardSuggestion?: (payload: { suggestionId?: string }) => void | Promise<void>;
	}

	let {
		messages,
		selectedId = $bindable<string | undefined>(undefined),
		emptyMessage,
		emptyState = 'no_matches',
		mailboxConnected = false,
		aiProviderConnected = false,
		smtpReady = false,
		role = 'member',
		mailSettingsHref = '/settings#mail',
		integrationsHref = '/org/integrations',
		showForward = false,
		draftDelayMs = 700,
		canAddToTimeline = true,
		sharingId = null,
		canCreateLead = false,
		class: className,
		onSendReply,
		onAddToTimeline,
		onCreateLead,
		onDraftResponse,
		onUseSuggestion,
		onDiscardSuggestion
	}: EntityEmailInboxProps = $props();

	let composing = $state(false);
	let replyBody = $state('');
	let suggestionBody = $state('');
	let suggestionId = $state<string | undefined>(undefined);
	let aiStatus = $state<AiSuggestionStatus>('idle');
	let tone = $state<DraftTone>('warm');
	let draftError = $state<string | null>(null);
	let shareError = $state<string | null>(null);
	let sendError = $state<string | null>(null);
	let sending = $state(false);
	const isNarrow = new IsMobile(1024);

	$effect(() => {
		if (isNarrow.current) return;
		if (selectedId === undefined && messages.length > 0) {
			selectedId = messages.find((m) => m.unread)?.id ?? messages[0]?.id;
		}
	});

	const selected = $derived(messages.find((m) => m.id === selectedId));
	const selectedHtml = $derived(selected?.bodyHtml ? sanitizeEmailHtml(selected.bodyHtml) : '');
	const selectedAttachments = $derived(selected?.attachments ?? []);
	const draftGate = $derived(draftResponseGateCopy(role));
	const draftDisabled = $derived(!aiProviderConnected);
	const sendDisabled = $derived(!smtpReady || !replyBody.trim() || sending);

	const emptyCopy = $derived.by(() => {
		if (emptyMessage) {
			return { title: emptyMessage, detail: null as string | null, ctaHref: null as string | null, ctaLabel: null as string | null };
		}
		switch (emptyState) {
			case 'no_mailbox':
				return {
					title: 'Connect your mailbox to see email here',
					detail:
						'Personal IMAP/SMTP lives under My settings → Mail. Organisation Email sending is a separate plane.',
					ctaHref: mailSettingsHref,
					ctaLabel: 'Open Mail settings'
				};
			case 'teammate_nothing_shared':
				return {
					title: 'No shared emails yet',
					detail:
						'Teammates only see mail that was added to the timeline — private inbox matches stay private.',
					ctaHref: null,
					ctaLabel: null
				};
			case 'empty_inbox':
				return {
					title: 'Your inbox is empty',
					detail: mailboxConnected
						? 'Messages owned by your connected mailbox appear here after sync. Contact and client Email tabs show address matches separately.'
						: 'Connect a mailbox under My settings → Mail to start syncing.',
					ctaHref: mailboxConnected ? null : mailSettingsHref,
					ctaLabel: mailboxConnected ? null : 'Open Mail settings'
				};
			case 'no_matches':
			default:
				return {
					title: 'No mail matched this person yet',
					detail: mailboxConnected
						? 'When sync finds messages to or from their address, they will appear here.'
						: 'Connect a mailbox to start matching messages.',
					ctaHref: mailboxConnected ? null : mailSettingsHref,
					ctaLabel: mailboxConnected ? null : 'Open Mail settings'
				};
		}
	});

	function setTone(id: string) {
		if (id === 'warm' || id === 'neutral' || id === 'firm') tone = id;
	}

	function startReply() {
		composing = true;
		replyBody = '';
		suggestionBody = '';
		suggestionId = undefined;
		aiStatus = 'idle';
		draftError = null;
		sendError = null;
		sending = false;
	}

	function cancelReply() {
		composing = false;
		replyBody = '';
		suggestionBody = '';
		suggestionId = undefined;
		aiStatus = 'idle';
		draftError = null;
		sendError = null;
		sending = false;
	}

	function createLeadFromSelected() {
		if (!selected || selected.direction !== 'in' || !onCreateLead) return;
		onCreateLead({
			messageId: selected.id,
			fromAddress: selected.fromAddress,
			fromName: selected.fromName?.trim() || null,
			subject: selected.subject
		});
	}

	/** Storybook-only fallback when `onDraftResponse` is omitted. Live pages always wire the API. */
	function buildDraft(message: EmailMessage, draftTone: DraftTone): string {
		const firstName = message.from.split('@')[0]?.split('.')[0] ?? 'there';
		const greeting = firstName.charAt(0).toUpperCase() + firstName.slice(1);
		return (
			`Hi ${greeting},\n\nThanks for your email about “${message.subject}”.\n\n` +
			`I will follow up shortly.\n\nThanks\n\nTONE: ${draftTone}\n`
		);
	}

	async function draftResponse() {
		if (!selected || draftDisabled) return;
		aiStatus = 'generating';
		draftError = null;
		const message = selected;
		const draftTone = tone;
		try {
			if (onDraftResponse) {
				const result = await onDraftResponse({ messageId: message.id, tone: draftTone });
				suggestionBody = result.suggestionText;
				suggestionId = result.suggestionId;
			} else {
				await new Promise((r) => setTimeout(r, draftDelayMs));
				suggestionBody = buildDraft(message, draftTone);
				suggestionId = undefined;
			}
			aiStatus = 'ready';
		} catch (error) {
			aiStatus = 'idle';
			if (isApiClientError(error) && error.message) {
				draftError = error.message;
			} else if (error instanceof Error && error.message) {
				draftError = error.message;
			} else {
				draftError = 'Could not draft a reply — try again.';
			}
		}
	}

	async function useSuggestion() {
		const text = suggestionBody;
		const id = suggestionId;
		try {
			await onUseSuggestion?.({ suggestionId: id, text });
		} catch {
			draftError = 'Could not apply suggestion — try again.';
			return;
		}
		replyBody = text;
		suggestionBody = '';
		suggestionId = undefined;
		aiStatus = 'idle';
	}

	async function discardSuggestion() {
		const id = suggestionId;
		try {
			await onDiscardSuggestion?.({ suggestionId: id });
		} catch {
			/* local discard still clears the panel */
		}
		suggestionBody = '';
		suggestionId = undefined;
		aiStatus = 'idle';
	}

	async function sendReply() {
		if (!selected || sendDisabled) return;
		sendError = null;
		if (!onSendReply) {
			// Storybook / local mock — no deliver path.
			cancelReply();
			return;
		}
		sending = true;
		try {
			await onSendReply({ messageId: selected.id, body: replyBody.trim() });
			cancelReply();
		} catch {
			sendError = 'Could not send reply — try again.';
		} finally {
			sending = false;
		}
	}

	async function addToTimeline() {
		if (!selected || !onAddToTimeline) return;
		shareError = null;
		try {
			await onAddToTimeline({ messageId: selected.id });
		} catch {
			shareError = 'Could not add to timeline — try again.';
		}
	}
</script>

<div
	class={cn(
		'bg-card overflow-hidden rounded-3xl ring-1 ring-foreground/5 dark:ring-foreground/10',
		'grid h-full min-h-0 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]',
		className
	)}
	data-testid="entity-email-inbox"
	data-empty-state={messages.length === 0 ? emptyState : undefined}
>
	<aside
		class={cn(
			'border-border/80 flex min-h-0 flex-col border-b lg:border-r lg:border-b-0',
			(selected || messages.length === 0) && 'hidden lg:flex'
		)}
	>
		<div class="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
			<p class="text-sm font-semibold tracking-tight">Inbox</p>
			<span class="text-muted-foreground text-xs">{messages.length}</span>
		</div>
		<ul class="m-0 min-h-0 flex-1 list-none overflow-y-auto overscroll-contain p-0">
			{#each messages as message (message.id)}
				<li>
					<button
						type="button"
						class={cn(
							'hover:bg-muted/60 w-full border-t px-4 py-3 text-left transition-colors',
							message.id === selectedId && 'bg-muted/80'
						)}
						onclick={() => {
							selectedId = message.id;
							cancelReply();
						}}
					>
						<div class="flex items-start justify-between gap-2">
							<p
								class={cn(
									'truncate text-sm',
									message.unread ? 'font-semibold' : 'font-medium'
								)}
							>
								{message.direction === 'in' ? message.from : `To ${message.to}`}
							</p>
							<span class="text-muted-foreground shrink-0 text-[11px]">{message.occurredAt}</span>
						</div>
						<p class={cn('mt-0.5 truncate text-sm', message.unread && 'font-medium')}>
							{message.subject}
						</p>
						<p class="text-muted-foreground mt-1 line-clamp-2 text-xs leading-relaxed">
							{message.preview}
						</p>
					</button>
				</li>
			{:else}
				<li class="text-muted-foreground px-4 py-10 text-center text-xs" data-testid="entity-email-list-empty">
					Inbox empty
				</li>
			{/each}
		</ul>
	</aside>

	<section
		class={cn(
			'flex min-h-0 flex-col overflow-hidden',
			!selected && messages.length > 0 && 'hidden lg:flex'
		)}
	>
		{#if selected}
			<header class="shrink-0 space-y-2 border-b px-5 py-4">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div class="min-w-0 space-y-1">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							class="-ms-2 mb-1 lg:hidden"
							data-testid="entity-email-back"
							onclick={() => {
								selectedId = undefined;
								cancelReply();
							}}
						>
							<ArrowLeftIcon class="size-4" />
							Inbox
						</Button>
						<h3 class="text-base font-semibold tracking-tight">{selected.subject}</h3>
						<p class="text-muted-foreground text-xs">
							{selected.direction === 'in' ? 'From' : 'To'}
							{selected.direction === 'in' ? selected.from : selected.to}
							· {selected.occurredAt}
						</p>
					</div>
					<div class="flex flex-wrap gap-2">
						{#if !composing}
							{#if canAddToTimeline && onAddToTimeline}
								<Button
									variant="outline"
									size="sm"
									onclick={addToTimeline}
									disabled={sharingId === selected.id}
									data-testid="email-add-to-timeline"
								>
									{sharingId === selected.id ? 'Adding…' : 'Add to timeline'}
								</Button>
							{/if}
							{#if canCreateLead && onCreateLead && selected.direction === 'in'}
								<Button
									variant="outline"
									size="sm"
									onclick={createLeadFromSelected}
									data-testid="email-create-lead"
								>
									Create lead
								</Button>
							{/if}
							<Button variant="outline" size="sm" onclick={startReply}>Reply</Button>
							{#if showForward}
								<Button size="sm">Forward</Button>
							{/if}
						{:else}
							<Button variant="ghost" size="sm" onclick={cancelReply}>Cancel</Button>
						{/if}
					</div>
				</div>
				{#if shareError}
					<p class="text-destructive text-xs" data-testid="email-share-error">{shareError}</p>
				{/if}
			</header>

			<div class="min-h-0 flex-1 overflow-y-auto">
				{#if selectedHtml}
					<div
						class="email-html-body px-5 py-5 text-sm leading-relaxed"
						data-testid="email-body-html"
					>
						{@html selectedHtml}
					</div>
				{:else}
					<div
						class="px-5 py-5 text-sm leading-relaxed whitespace-pre-wrap"
						data-testid="email-body-text"
					>
						{selected.body}
					</div>
				{/if}

				{#if selectedAttachments.length > 0}
					<div class="border-border flex flex-wrap gap-2 border-t px-5 py-3" data-testid="email-attachments">
						{#each selectedAttachments as attachment (attachment.filename + attachment.contentType)}
							<span
								class="bg-muted text-muted-foreground rounded-full px-2.5 py-1 text-xs"
								data-testid="email-attachment-chip"
							>
								{attachment.filename}{#if attachment.contentType}<span class="opacity-70"> · {attachment.contentType}</span>{/if}
							</span>
						{/each}
					</div>
				{/if}

				{#if composing}
					<div class="border-border space-y-3 border-t px-5 py-4">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<div>
								<p class="text-sm font-semibold tracking-tight">Reply</p>
								<p class="text-muted-foreground text-xs">
									To {selected.direction === 'in' ? selected.from : selected.to}
								</p>
							</div>
							<div class="flex flex-wrap items-center gap-2">
								<div class="flex gap-1">
									{#each [
										{ id: 'warm', label: 'Warm' },
										{ id: 'neutral', label: 'Neutral' },
										{ id: 'firm', label: 'Firm' }
									] as option (option.id)}
										<button
											type="button"
											class={cn(
												'rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors',
												tone === option.id
													? 'bg-foreground text-background ring-foreground'
													: 'bg-background text-foreground ring-foreground/10 hover:bg-muted'
											)}
											onclick={() => setTone(option.id)}
										>
											{option.label}
										</button>
									{/each}
								</div>
								<AiAssistAction
									label="Draft response"
									busy={aiStatus === 'generating'}
									disabled={draftDisabled}
									onclick={draftResponse}
								/>
							</div>
						</div>

						{#if draftDisabled}
							<p class="text-muted-foreground text-xs" data-testid="draft-response-gate">
								{draftGate.hint}
								<a
									href={draftGate.href || integrationsHref}
									class="text-foreground font-medium underline underline-offset-2"
								>
									{draftGate.linkLabel}
								</a>
							</p>
						{/if}
						{#if draftError}
							<p class="text-destructive text-xs" data-testid="draft-response-error">{draftError}</p>
						{/if}

						{#if aiStatus === 'ready'}
							<div
								class="bg-muted/40 space-y-2 rounded-2xl px-3 py-3"
								data-testid="draft-suggestion-panel"
							>
								<p class="text-xs font-medium">AI suggestion — edit before you send.</p>
								<pre class="text-muted-foreground whitespace-pre-wrap font-sans text-xs leading-relaxed">{suggestionBody}</pre>
								<div class="flex justify-end gap-2">
									<Button type="button" size="sm" variant="ghost" onclick={discardSuggestion}>
										Discard
									</Button>
									<Button
										type="button"
										size="sm"
										onclick={useSuggestion}
										data-testid="use-suggestion"
									>
										Use suggestion
									</Button>
								</div>
							</div>
						{/if}

						<Textarea
							bind:value={replyBody}
							rows={7}
							placeholder="Write a reply, or use Draft response…"
							class="min-h-[140px] resize-y text-sm"
						/>

						<div class="flex flex-col items-end gap-1">
							{#if sendError}
								<p class="text-destructive text-xs" data-testid="email-send-error">{sendError}</p>
							{/if}
							<div class="flex justify-end gap-2">
								<Button
									type="button"
									size="sm"
									variant="outline"
									onclick={cancelReply}
									disabled={sending}
								>
									Discard
								</Button>
								<Button
									type="button"
									size="sm"
									disabled={sendDisabled}
									onclick={sendReply}
									data-testid="email-send"
									title={smtpReady ? undefined : 'Connect mailbox in My settings'}
								>
									{sending ? 'Sending…' : 'Send'}
								</Button>
							</div>
							{#if !smtpReady}
								<p class="text-muted-foreground text-xs" data-testid="email-send-gate">
									Connect mailbox in <a
										href={mailSettingsHref}
										class="text-foreground font-medium underline underline-offset-2"
										>My settings</a
									> before sending.
								</p>
							{/if}
						</div>
					</div>
				{/if}
			</div>
		{:else}
			<div
				class="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center"
				data-testid="entity-email-empty-pane"
			>
				<p class="text-sm font-medium">{emptyCopy.title}</p>
				{#if emptyCopy.detail}
					<p class="text-muted-foreground max-w-sm text-xs leading-relaxed">{emptyCopy.detail}</p>
				{/if}
				{#if emptyCopy.ctaHref && emptyCopy.ctaLabel}
					<a
						href={emptyCopy.ctaHref}
						class="text-foreground text-xs font-medium underline underline-offset-2"
						data-testid="entity-email-empty-cta"
					>
						{emptyCopy.ctaLabel}
					</a>
				{/if}
			</div>
		{/if}
	</section>
</div>

<style>
	.email-html-body :global {
		a {
			color: inherit;
			text-decoration: underline;
		}

		img {
			max-width: 100%;
			height: auto;
		}
	}
</style>

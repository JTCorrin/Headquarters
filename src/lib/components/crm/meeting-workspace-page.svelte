<script lang="ts">
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import InfoCard, { type InfoCardField } from './info-card.svelte';
	import StatusBadge from './status-badge.svelte';
	import AiAssistAction from './ai-assist-action.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import CheckIcon from '@lucide/svelte/icons/check';
	import XIcon from '@lucide/svelte/icons/x';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	export interface ProposedMeetingTask {
		id: string;
		title: string;
		assignee?: string;
		status?: 'proposed' | 'accepted' | 'dismissed';
		/** @deprecated prefer status === 'accepted' */
		accepted?: boolean;
	}

	export interface MeetingWorkspacePageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		title: string;
		status: string;
		when: string;
		relatedTo: string;
		/** Schedule metadata (when, timezone, location, URL, related). */
		scheduleFields?: InfoCardField[];
		attendeeFields: InfoCardField[];
		transcript?: string;
		transcriptStatusLabel?: string;
		summary?: string;
		summaryStatusLabel?: string;
		proposedTasks?: ProposedMeetingTask[];
		/** When false, omit AppNav (shell already renders it). */
		showNav?: boolean;
		actionError?: string | null;
		actionBusy?: boolean;
		generateEnabled?: boolean;
		onUploadTranscript?: () => void;
		onGenerateSummary?: () => void;
		onAcceptTask?: (id: string) => void;
		onDismissTask?: (id: string) => void;
		onAcceptAllTasks?: () => void;
		onEdit?: () => void;
		onDelete?: () => void;
		class?: string;
	}

	let {
		orgName,
		navGroups,
		title,
		status = 'Scheduled',
		when,
		relatedTo,
		scheduleFields = [],
		attendeeFields,
		transcript = '',
		transcriptStatusLabel,
		summary = '',
		summaryStatusLabel,
		proposedTasks = $bindable<ProposedMeetingTask[]>([]),
		showNav = true,
		actionError = null,
		actionBusy = false,
		generateEnabled = true,
		onUploadTranscript,
		onGenerateSummary,
		onAcceptTask,
		onDismissTask,
		onAcceptAllTasks,
		onEdit,
		onDelete,
		class: className
	}: MeetingWorkspacePageProps = $props();

	const aiEnabled = $derived(Boolean(onUploadTranscript || onGenerateSummary));
	const openProposals = $derived(
		proposedTasks.filter((task) => {
			const status = task.status ?? (task.accepted ? 'accepted' : 'proposed');
			return status === 'proposed';
		})
	);

	function taskStatus(task: ProposedMeetingTask): 'proposed' | 'accepted' | 'dismissed' {
		if (task.status) return task.status;
		return task.accepted ? 'accepted' : 'proposed';
	}
</script>

<div
	class={cn(
		'bg-background text-foreground flex',
		showNav ? 'h-full min-h-[720px]' : 'min-h-0 flex-1 flex-col',
		className
	)}
>
	{#if showNav}
		<AppNav {orgName} groups={navGroups} class="shrink-0" />
	{/if}

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-6 py-6 md:px-8">
			<PageHeader
				breadcrumb="Work / Meetings"
				{title}
				{status}
				description="{when} · {relatedTo}"
			>
				{#snippet actions()}
					{#if onEdit}
						<Button
							variant="outline"
							size="sm"
							disabled={actionBusy}
							onclick={() => onEdit?.()}
						>
							<PencilIcon class="size-3.5" />
							Edit
						</Button>
					{/if}
					{#if onDelete}
						<Button
							variant="outline"
							size="sm"
							disabled={actionBusy}
							onclick={() => onDelete?.()}
						>
							<Trash2Icon class="size-3.5" />
							Delete
						</Button>
					{/if}
					<Button
						variant="outline"
						size="sm"
						disabled={!onUploadTranscript || actionBusy}
						onclick={() => onUploadTranscript?.()}
					>
						<UploadIcon class="size-3.5" />
						Upload transcript
					</Button>
					<AiAssistAction
						label="Generate summary"
						variant="secondary"
						size="default"
						disabled={!onGenerateSummary || !generateEnabled || actionBusy}
						onclick={() => onGenerateSummary?.()}
					/>
				{/snippet}
			</PageHeader>

			{#if actionError}
				<p class="text-destructive text-sm" role="alert" data-testid="meeting-ai-error">
					{actionError}
				</p>
			{/if}

			<div class="grid items-start gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
				<div class="space-y-6">
					{#if scheduleFields.length}
						<InfoCard title="Schedule" fields={scheduleFields} />
					{/if}
					<InfoCard title="Attendees" fields={attendeeFields} />

					<section
						class="bg-card space-y-3 rounded-3xl p-5 ring-1 ring-foreground/5 dark:ring-foreground/10"
					>
						<div class="flex items-center justify-between gap-2">
							<h2 class="text-sm font-semibold tracking-tight">Transcript</h2>
							{#if transcript || transcriptStatusLabel}
								<StatusBadge status={transcriptStatusLabel || (transcript ? 'Ready' : 'Missing')} />
							{:else}
								<StatusBadge status="Missing" />
							{/if}
						</div>
						{#if transcript}
							<pre
								class="bg-muted/50 max-h-72 overflow-y-auto rounded-2xl p-4 font-sans text-sm leading-relaxed whitespace-pre-wrap">{transcript}</pre>
						{:else}
							<p class="text-muted-foreground text-sm">
								{#if aiEnabled}
									Upload a transcript file (text, Markdown, VTT, or PDF) to unlock summary generation.
								{:else}
									Transcript upload arrives in a later slice — schedule and attendees are live now.
								{/if}
							</p>
							{#if onUploadTranscript}
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={actionBusy}
									onclick={() => onUploadTranscript?.()}
								>
									<UploadIcon class="size-3.5" />
									Add transcript
								</Button>
							{/if}
						{/if}
					</section>
				</div>

				<div class="space-y-6">
					<section
						class="bg-card space-y-3 rounded-3xl p-5 ring-1 ring-foreground/5 dark:ring-foreground/10"
					>
						<div class="flex items-center justify-between gap-2">
							<h2 class="text-sm font-semibold tracking-tight">AI summary</h2>
							{#if summary || summaryStatusLabel}
								<StatusBadge
									status={summaryStatusLabel || (summary ? 'Ready' : 'Missing')}
								/>
							{/if}
						</div>
						{#if summary}
							<div
								class="bg-muted/40 text-sm leading-relaxed whitespace-pre-wrap rounded-2xl p-4"
							>
								{summary}
							</div>
						{:else}
							<p class="text-muted-foreground text-sm">
								{#if aiEnabled}
									Generate a summary once a transcript is attached. Action items land below.
								{:else}
									AI summary stays empty until the meeting assistant slice.
								{/if}
							</p>
						{/if}
					</section>

					<section
						class="bg-card space-y-3 rounded-3xl p-5 ring-1 ring-foreground/5 dark:ring-foreground/10"
					>
						<div class="flex items-center justify-between gap-2">
							<h2 class="text-sm font-semibold tracking-tight">Proposed tasks</h2>
							{#if openProposals.length && onAcceptAllTasks}
								<Button
									type="button"
									size="sm"
									variant="outline"
									disabled={actionBusy}
									onclick={() => onAcceptAllTasks?.()}
								>
									Accept all
								</Button>
							{/if}
						</div>
						{#if proposedTasks.length === 0}
							<p class="text-muted-foreground text-sm">
								No proposed tasks yet — generate a summary to extract follow-ups.
							</p>
						{:else}
							<ul class="m-0 list-none space-y-2 p-0">
								{#each proposedTasks as task (task.id)}
									{@const rowStatus = taskStatus(task)}
									<li
										class="flex items-center justify-between gap-3 rounded-2xl border px-3 py-2"
									>
										<div class="min-w-0">
											<p
												class={cn(
													'truncate text-sm font-medium',
													rowStatus !== 'proposed' && 'text-muted-foreground',
													rowStatus === 'accepted' && 'line-through',
													rowStatus === 'dismissed' && 'line-through opacity-70'
												)}
											>
												{task.title}
											</p>
											{#if task.assignee}
												<p class="text-muted-foreground text-xs">{task.assignee}</p>
											{/if}
										</div>
										{#if rowStatus === 'accepted'}
											<StatusBadge status="Accepted" />
										{:else if rowStatus === 'dismissed'}
											<StatusBadge status="Dismissed" />
										{:else}
											<div class="flex shrink-0 items-center gap-1.5">
												{#if onDismissTask}
													<Button
														type="button"
														size="sm"
														variant="ghost"
														disabled={actionBusy}
														onclick={() => onDismissTask?.(task.id)}
													>
														<XIcon class="size-3.5" />
														Dismiss
													</Button>
												{/if}
												{#if onAcceptTask}
													<Button
														type="button"
														size="sm"
														variant="outline"
														disabled={actionBusy}
														onclick={() => onAcceptTask?.(task.id)}
													>
														<CheckIcon class="size-3.5" />
														Accept
													</Button>
												{/if}
											</div>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
					</section>
				</div>
			</div>
		</div>
	</main>
</div>

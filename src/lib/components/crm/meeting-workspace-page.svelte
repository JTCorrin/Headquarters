<script lang="ts">
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import InfoCard, { type InfoCardField } from './info-card.svelte';
	import StatusBadge from './status-badge.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import CheckIcon from '@lucide/svelte/icons/check';

	export interface ProposedMeetingTask {
		id: string;
		title: string;
		assignee?: string;
		accepted?: boolean;
	}

	export interface MeetingWorkspacePageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		title: string;
		status: string;
		when: string;
		relatedTo: string;
		attendeeFields: InfoCardField[];
		transcript?: string;
		summary?: string;
		proposedTasks?: ProposedMeetingTask[];
		onUploadTranscript?: () => void;
		onGenerateSummary?: () => void;
		onAcceptTask?: (id: string) => void;
		onAcceptAllTasks?: () => void;
		class?: string;
	}

	let {
		orgName,
		navGroups,
		title,
		status = 'Scheduled',
		when,
		relatedTo,
		attendeeFields,
		transcript = '',
		summary = '',
		proposedTasks = $bindable<ProposedMeetingTask[]>([]),
		onUploadTranscript,
		onGenerateSummary,
		onAcceptTask,
		onAcceptAllTasks,
		class: className
	}: MeetingWorkspacePageProps = $props();
</script>

<div class={cn('bg-background text-foreground flex h-full min-h-[720px]', className)}>
	<AppNav {orgName} groups={navGroups} class="shrink-0" />

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-6 py-6 md:px-8">
			<PageHeader
				breadcrumb="Work / Meetings"
				{title}
				{status}
				description="{when} · {relatedTo}"
			>
				{#snippet actions()}
					<Button variant="outline" size="sm" onclick={() => onUploadTranscript?.()}>
						<UploadIcon class="size-3.5" />
						Upload transcript
					</Button>
					<Button size="sm" onclick={() => onGenerateSummary?.()}>
						<SparklesIcon class="size-3.5" />
						Generate summary
					</Button>
				{/snippet}
			</PageHeader>

			<div class="grid items-start gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
				<div class="space-y-6">
					<InfoCard title="Attendees" fields={attendeeFields} />

					<section
						class="bg-card space-y-3 rounded-3xl p-5 ring-1 ring-foreground/5 dark:ring-foreground/10"
					>
						<div class="flex items-center justify-between gap-2">
							<h2 class="text-sm font-semibold tracking-tight">Transcript</h2>
							{#if transcript}
								<StatusBadge status="Ready" />
							{:else}
								<StatusBadge status="Missing" />
							{/if}
						</div>
						{#if transcript}
							<pre
								class="bg-muted/50 max-h-72 overflow-y-auto rounded-2xl p-4 font-sans text-sm leading-relaxed whitespace-pre-wrap">{transcript}</pre>
						{:else}
							<p class="text-muted-foreground text-sm">
								Upload a transcript file or pull from a transcription service. Storybook mocks the
								upload.
							</p>
							<Button type="button" variant="outline" size="sm" onclick={() => onUploadTranscript?.()}>
								<UploadIcon class="size-3.5" />
								Add transcript
							</Button>
						{/if}
					</section>
				</div>

				<div class="space-y-6">
					<section
						class="bg-card space-y-3 rounded-3xl p-5 ring-1 ring-foreground/5 dark:ring-foreground/10"
					>
						<div class="flex items-center justify-between gap-2">
							<h2 class="text-sm font-semibold tracking-tight">AI summary</h2>
							{#if summary}
								<StatusBadge status="Draft" />
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
								Generate a summary once a transcript is attached. Action items land below.
							</p>
						{/if}
					</section>

					<section
						class="bg-card space-y-3 rounded-3xl p-5 ring-1 ring-foreground/5 dark:ring-foreground/10"
					>
						<div class="flex items-center justify-between gap-2">
							<h2 class="text-sm font-semibold tracking-tight">Proposed tasks</h2>
							{#if proposedTasks.length}
								<Button type="button" size="sm" variant="outline" onclick={() => onAcceptAllTasks?.()}>
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
									<li
										class="flex items-center justify-between gap-3 rounded-2xl border px-3 py-2"
									>
										<div class="min-w-0">
											<p
												class={cn(
													'truncate text-sm font-medium',
													task.accepted && 'text-muted-foreground line-through'
												)}
											>
												{task.title}
											</p>
											{#if task.assignee}
												<p class="text-muted-foreground text-xs">{task.assignee}</p>
											{/if}
										</div>
										{#if task.accepted}
											<StatusBadge status="Done" />
										{:else}
											<Button
												type="button"
												size="sm"
												variant="outline"
												onclick={() => onAcceptTask?.(task.id)}
											>
												<CheckIcon class="size-3.5" />
												Accept
											</Button>
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

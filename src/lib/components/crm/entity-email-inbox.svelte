<script lang="ts">
	import { cn } from '$lib/utils.js';
	import { Button } from '$lib/components/ui/button/index.js';

	export interface EmailMessage {
		id: string;
		direction: 'in' | 'out';
		from: string;
		to: string;
		subject: string;
		preview: string;
		body: string;
		occurredAt: string;
		unread?: boolean;
	}

	export interface EntityEmailInboxProps {
		messages: EmailMessage[];
		selectedId?: string;
		emptyMessage?: string;
		class?: string;
	}

	let {
		messages,
		selectedId = $bindable<string | undefined>(undefined),
		emptyMessage = 'No messages for this entity yet.',
		class: className
	}: EntityEmailInboxProps = $props();

	$effect(() => {
		if (selectedId === undefined && messages.length > 0) {
			selectedId = messages.find((m) => m.unread)?.id ?? messages[0]?.id;
		}
	});

	const selected = $derived(messages.find((m) => m.id === selectedId));
</script>

<div
	class={cn(
		'bg-card overflow-hidden rounded-3xl ring-1 ring-foreground/5 dark:ring-foreground/10',
		'grid min-h-[420px] lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]',
		className
	)}
>
	<aside class="border-border/80 flex max-h-[560px] flex-col border-b lg:border-r lg:border-b-0">
		<div class="flex items-center justify-between gap-2 px-4 py-3">
			<p class="text-sm font-semibold tracking-tight">Inbox</p>
			<span class="text-muted-foreground text-xs">{messages.length}</span>
		</div>
		<ul class="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0">
			{#each messages as message (message.id)}
				<li>
					<button
						type="button"
						class={cn(
							'hover:bg-muted/60 w-full border-t px-4 py-3 text-left transition-colors',
							message.id === selectedId && 'bg-muted/80'
						)}
						onclick={() => (selectedId = message.id)}
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
				<li class="text-muted-foreground px-4 py-10 text-center text-sm">{emptyMessage}</li>
			{/each}
		</ul>
	</aside>

	<section class="flex min-h-[320px] flex-col">
		{#if selected}
			<header class="space-y-2 border-b px-5 py-4">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div class="min-w-0 space-y-1">
						<h3 class="text-base font-semibold tracking-tight">{selected.subject}</h3>
						<p class="text-muted-foreground text-xs">
							{selected.direction === 'in' ? 'From' : 'To'}
							{selected.direction === 'in' ? selected.from : selected.to}
							· {selected.occurredAt}
						</p>
					</div>
					<div class="flex gap-2">
						<Button variant="outline" size="sm">Reply</Button>
						<Button size="sm">Forward</Button>
					</div>
				</div>
			</header>
			<div class="text-sm leading-relaxed whitespace-pre-wrap px-5 py-5">
				{selected.body}
			</div>
		{:else}
			<div class="text-muted-foreground flex flex-1 items-center justify-center px-6 text-sm">
				{emptyMessage}
			</div>
		{/if}
	</section>
</div>

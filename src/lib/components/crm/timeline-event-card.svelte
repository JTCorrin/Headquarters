<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { cn } from '$lib/utils.js';

	export interface TimelineEventCardProps {
		kind: string;
		title: string;
		body?: string;
		occurredAt: string;
		class?: string;
	}

	let { kind, title, body, occurredAt, class: className }: TimelineEventCardProps = $props();
</script>

<Card.Root class={cn(className)} size="sm">
	<Card.Header class="gap-1.5">
		<p class="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
			{occurredAt} · {kind}
		</p>
		<Card.Title class="text-base font-semibold">{title}</Card.Title>
		{#if body}
			<Card.Description class="text-sm leading-relaxed">{body}</Card.Description>
		{/if}
	</Card.Header>
</Card.Root>

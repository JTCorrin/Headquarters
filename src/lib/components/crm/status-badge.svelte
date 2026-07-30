<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { cn } from '$lib/utils.js';

	export interface StatusBadgeProps {
		status: string;
		class?: string;
	}

	let { status, class: className }: StatusBadgeProps = $props();

	const variant = $derived.by(() => {
		const key = status.toLowerCase();
		if (['paid', 'won', 'active', 'client'].includes(key)) return 'default' as const;
		if (['lead', 'sent', 'proposal', 'doing', 'archived'].includes(key)) return 'secondary' as const;
		if (['lost', 'void', 'overdue', 'suspended'].includes(key)) return 'destructive' as const;
		return 'outline' as const;
	});
</script>

<Badge {variant} class={cn('capitalize', className)}>{status}</Badge>

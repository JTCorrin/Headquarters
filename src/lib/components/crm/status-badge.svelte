<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { cn } from '$lib/utils.js';

	export interface StatusBadgeProps {
		status: string;
		class?: string;
	}

	let { status = '', class: className }: StatusBadgeProps = $props();

	const variant = $derived.by(() => {
		const key = status.toLowerCase();
		if (['paid', 'won', 'active', 'client', 'primary', 'ready', 'completed', 'done'].includes(key))
			return 'default' as const;
		if (
			[
				'lead',
				'sent',
				'proposal',
				'doing',
				'in progress',
				'archived',
				'billing',
				'received',
				'scheduled',
				'part paid',
				'partial',
				'draft',
				'open'
			].includes(key)
		)
			return 'secondary' as const;
		if (['lost', 'void', 'overdue', 'suspended', 'missing', 'cancelled'].includes(key))
			return 'destructive' as const;
		return 'outline' as const;
	});
</script>

<Badge {variant} class={cn('capitalize', className)}>{status || 'Unknown'}</Badge>

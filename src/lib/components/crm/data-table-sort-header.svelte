<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
	import { Button } from '$lib/components/ui/button/index.js';

	let {
		label,
		variant = 'ghost',
		...restProps
	}: ComponentProps<typeof Button> & { label: string } = $props();
</script>

<Button {variant} size="sm" class="-ms-3 h-8" {...restProps}>
	{label}
	<ArrowUpDownIcon class="ms-1.5 size-3.5 opacity-70" />
</Button>

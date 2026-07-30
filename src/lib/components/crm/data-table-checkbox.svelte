<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';

	let {
		checked = false,
		indeterminate = false,
		onCheckedChange = (v: boolean | 'indeterminate') => {
			checked = !!v;
		},
		...restProps
	}: ComponentProps<typeof Checkbox> = $props();
</script>

<Checkbox bind:checked={() => checked, onCheckedChange} {indeterminate} {...restProps} />

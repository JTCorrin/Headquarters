<script lang="ts">
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';

	export interface DataTableCheckboxProps {
		checked?: boolean;
		indeterminate?: boolean;
		onCheckedChange?: (value: boolean) => void;
		'aria-label'?: string;
		disabled?: boolean;
	}

	let {
		checked = false,
		indeterminate = false,
		onCheckedChange,
		...restProps
	}: DataTableCheckboxProps = $props();
</script>

<Checkbox
	{checked}
	{indeterminate}
	onCheckedChange={(value) => onCheckedChange?.(!!value)}
	{...restProps}
/>

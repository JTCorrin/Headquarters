<script lang="ts">
	import DateRangeField from './date-range-field.svelte';

	export interface DateRangeFieldTestHostProps {
		initialStart?: string;
		initialEnd?: string;
		disabled?: boolean;
	}

	let {
		initialStart = '',
		initialEnd = '',
		disabled = false
	}: DateRangeFieldTestHostProps = $props();

	let startValue = $state(initialStart);
	let endValue = $state(initialEnd);
</script>

<div data-testid="date-range-host">
	<DateRangeField
		startId="range-start"
		endId="range-end"
		startName="startOn"
		endName="endOn"
		bind:startValue
		bind:endValue
		{disabled}
		data-testid="date-range-field"
	/>
	<p data-testid="date-range-start-value">{startValue}</p>
	<p data-testid="date-range-end-value">{endValue}</p>
</div>

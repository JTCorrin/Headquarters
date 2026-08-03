<script lang="ts">
	import type { DateFieldPreset } from '$lib/date-field.js';
	import DateField from './date-field.svelte';

	export interface DateFieldTestHostProps {
		initial?: string;
		disabled?: boolean;
		readonly?: boolean;
		clearable?: boolean;
		presets?: DateFieldPreset[];
		min?: string;
		max?: string;
	}

	let {
		initial = '',
		disabled = false,
		readonly = false,
		clearable = true,
		presets = ['today'],
		min = '',
		max = ''
	}: DateFieldTestHostProps = $props();

	let value = $state(initial);
</script>

<div data-testid="date-field-host">
	<DateField
		id="date-field-under-test"
		name="occurredOn"
		bind:value
		{disabled}
		{readonly}
		{clearable}
		{presets}
		{min}
		{max}
		data-testid="date-field"
	/>
	<p data-testid="date-field-value">{value}</p>
</div>

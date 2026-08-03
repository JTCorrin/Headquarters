<script lang="ts">
	import DateField from './date-field.svelte';

	export interface DateFieldTestHostProps {
		initial?: string;
		disabled?: boolean;
		readonly?: boolean;
		clearable?: boolean;
	}

	let {
		initial = '',
		disabled = false,
		readonly = false,
		clearable = true
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
		data-testid="date-field"
	/>
	<p data-testid="date-field-value">{value}</p>
</div>

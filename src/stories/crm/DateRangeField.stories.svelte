<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import DateRangeField from '$lib/components/crm/date-range-field.svelte';

	const { Story } = defineMeta({
		title: 'Headquarters/DateRangeField',
		component: DateRangeField,
		tags: ['autodocs']
	});
</script>

<script lang="ts">
	let startOn = $state('2026-08-01');
	let endOn = $state('2026-08-31');
	let emptyStart = $state('');
	let emptyEnd = $state('');
</script>

<Story name="Range calendar">
	{#snippet template()}
		<div class="bg-background max-w-xl p-8">
			<DateRangeField bind:startValue={startOn} bind:endValue={endOn} />
			<p class="text-muted-foreground mt-3 text-xs">
				Start {startOn || '—'} · End {endOn || '—'} (two YYYY-MM-DD strings)
			</p>
		</div>
	{/snippet}
</Story>

<Story name="Empty optional end">
	{#snippet template()}
		<div class="bg-background max-w-xl p-8">
			<DateRangeField bind:startValue={emptyStart} bind:endValue={emptyEnd} />
			<p class="text-muted-foreground mt-3 text-xs">
				Pick a range in the calendar, or type. End stays optional; end ≥ start when both set.
			</p>
		</div>
	{/snippet}
</Story>

<Story name="Readonly">
	{#snippet template()}
		<div class="bg-background max-w-xl p-8">
			<DateRangeField startValue="2026-09-01" endValue="2026-12-31" readonly />
		</div>
	{/snippet}
</Story>

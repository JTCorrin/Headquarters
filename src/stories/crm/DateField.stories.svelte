<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import DateField from '$lib/components/crm/date-field.svelte';

	const { Story } = defineMeta({
		title: 'Headquarters/DateField',
		component: DateField,
		tags: ['autodocs']
	});
</script>

<script lang="ts">
	let empty = $state('');
	let filled = $state('2026-08-15');
	let due = $state('2026-08-20');
	let issue = $state('2026-08-10');
</script>

<Story name="Picker with input">
	{#snippet template()}
		<div class="bg-background flex max-w-sm flex-col gap-2 p-8">
			<label class="text-sm font-medium" for="story-date-empty">Subscription date</label>
			<DateField id="story-date-empty" bind:value={empty} />
			<p class="text-muted-foreground text-xs">Typed YYYY-MM-DD + calendar trigger. Value: {empty || '—'}</p>
		</div>
	{/snippet}
</Story>

<Story name="With value">
	{#snippet template()}
		<div class="bg-background flex max-w-sm flex-col gap-2 p-8">
			<label class="text-sm font-medium" for="story-date-filled">Occurred on</label>
			<DateField id="story-date-filled" bind:value={filled} />
		</div>
	{/snippet}
</Story>

<Story name="Due date presets">
	{#snippet template()}
		<div class="bg-background flex max-w-sm flex-col gap-2 p-8">
			<label class="text-sm font-medium" for="story-date-due">Due on</label>
			<DateField
				id="story-date-due"
				bind:value={due}
				presets={['today', 'plus7', 'endOfMonth']}
			/>
			<p class="text-muted-foreground text-xs">
				Presets: Today, +7 days, End of month. Value: {due || '—'}
			</p>
		</div>
	{/snippet}
</Story>

<Story name="Min from issue date">
	{#snippet template()}
		<div class="bg-background flex max-w-sm flex-col gap-4 p-8">
			<div class="flex flex-col gap-2">
				<label class="text-sm font-medium" for="story-date-issue">Issue on</label>
				<DateField id="story-date-issue" bind:value={issue} />
			</div>
			<div class="flex flex-col gap-2">
				<label class="text-sm font-medium" for="story-date-due-min">Due on</label>
				<DateField
					id="story-date-due-min"
					bind:value={due}
					min={issue}
					presets={['today', 'plus7', 'endOfMonth']}
				/>
			</div>
			<p class="text-muted-foreground text-xs">Due minValue tracks issue date ({issue || '—'}).</p>
		</div>
	{/snippet}
</Story>

<Story name="Disabled">
	{#snippet template()}
		<div class="bg-background flex max-w-sm flex-col gap-2 p-8">
			<label class="text-sm font-medium" for="story-date-disabled">Locked date</label>
			<DateField id="story-date-disabled" value="2026-01-01" disabled />
		</div>
	{/snippet}
</Story>

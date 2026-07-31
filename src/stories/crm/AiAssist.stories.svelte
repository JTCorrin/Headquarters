<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import AiAssistAction from '$lib/components/crm/ai-assist-action.svelte';
	import AiSuggestionPanel from '$lib/components/crm/ai-suggestion-panel.svelte';

	const { Story } = defineMeta({
		title: 'Headquarters/AiAssist',
		tags: ['autodocs'],
		parameters: { layout: 'padded' }
	});
</script>

<script lang="ts">
	import type { AiSuggestionStatus } from '$lib/components/crm/ai-suggestion-panel.svelte';

	let status = $state<AiSuggestionStatus>('idle');
	let value = $state('');
	let tone = $state('warm');

	async function generate() {
		status = 'generating';
		await new Promise((r) => setTimeout(r, 600));
		value =
			tone === 'firm'
				? 'Hi Ava,\n\nPlease confirm the kickoff slot by Wednesday.\n\nThanks'
				: 'Hi Ava,\n\nThursday morning sounds perfect — I’ll send a short agenda soon.\n\nWarm regards';
		status = 'ready';
	}
</script>

<Story name="ActionButton">
	{#snippet template()}
		<div class="flex flex-wrap gap-3 p-6">
			<AiAssistAction label="Draft response" />
			<AiAssistAction label="Draft chase" />
			<AiAssistAction label="Generate summary" busy />
		</div>
	{/snippet}
</Story>

<Story name="SuggestionPanel">
	{#snippet template()}
		<div class="mx-auto max-w-xl p-6">
			<AiSuggestionPanel
				title="Draft response"
				hint="Tight task assist — edit before use. No chat window."
				generateLabel="Draft response"
				useLabel="Insert into reply"
				bind:value
				bind:activeVariant={tone}
				{status}
				variants={[
					{ id: 'warm', label: 'Warm' },
					{ id: 'firm', label: 'Firm' }
				]}
				onGenerate={generate}
				onVariantChange={(id) => {
					tone = id;
					if (status === 'ready') generate();
				}}
				onDiscard={() => {
					value = '';
					status = 'idle';
				}}
				onUse={() => {
					status = 'idle';
				}}
			/>
		</div>
	{/snippet}
</Story>

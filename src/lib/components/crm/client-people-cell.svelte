<script lang="ts">
	import ContactNameLink from './contact-name-link.svelte';
	import type { ClientPersonLink } from './clients-columns.js';

	export interface ClientPeopleCellProps {
		people?: ClientPersonLink[];
	}

	let { people = [] }: ClientPeopleCellProps = $props();
</script>

{#if people.length === 0}
	<span class="text-muted-foreground">—</span>
{:else}
	<span class="flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
		{#each people as person, index (person.id)}
			{#if index > 0}<span class="text-muted-foreground">,</span>{/if}
			<ContactNameLink id={person.id} name={person.name} />
		{/each}
	</span>
{/if}

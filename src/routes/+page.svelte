<script lang="ts">
	import { goto } from '$app/navigation';
	import { getOrgSession } from '$lib/org/index.js';
	import { onMount } from 'svelte';

	const session = getOrgSession();

	onMount(() => {
		if (session.selectedOrgId) {
			void goto('/org/config');
		} else {
			void goto('/select-org');
		}
	});
</script>

<p class="text-muted-foreground p-6 text-sm">Redirecting…</p>

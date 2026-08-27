<script lang="ts">
	import type { AiProvider } from '$lib/schemas/integration.js';
	import AiProviderConnectDrawer from './ai-provider-connect-drawer.svelte';

	export interface AiProviderDrawerTestHostProps {
		provider: AiProvider | null;
		open?: boolean;
		connectError?: string | null;
		onConnect?: (apiKey: string) => boolean | void | Promise<boolean | void>;
	}

	let {
		provider,
		open = $bindable(true),
		connectError = null,
		onConnect
	}: AiProviderDrawerTestHostProps = $props();
</script>

<AiProviderConnectDrawer {provider} bind:open {connectError} {onConnect} />
<p data-testid="drawer-open-state">{String(open)}</p>

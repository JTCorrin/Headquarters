<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { getAuthSession } from '$lib/auth/index.js';
	import { logoutAndRedirect } from '$lib/auth/logout.js';
	import { getOrgSession } from '$lib/org/index.js';
	import SelectOrgPage from '$lib/components/crm/select-org-page.svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	const api = getApiV1Client();
	const session = getOrgSession();
	const auth = getAuthSession();
	let logoutError = $state<string | null>(null);

	async function handleLogout() {
		logoutError = await logoutAndRedirect(auth, session);
	}
</script>

<div class="relative">
	{#if auth.enabled}
		<div class="absolute end-4 top-4 z-10">
			{#if logoutError}
				<p class="mb-2 text-sm text-destructive" role="alert">{logoutError}</p>
			{/if}
			<Button
				type="button"
				variant="outline"
				size="sm"
				onclick={() => {
					void handleLogout();
				}}
				data-testid="auth-logout"
			>
				Log out
			</Button>
		</div>
	{/if}
	<SelectOrgPage
		{api}
		{session}
		onSelected={() => {
			void goto(resolve('/org/config'));
		}}
	/>
</div>

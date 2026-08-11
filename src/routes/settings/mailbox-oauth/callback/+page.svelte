<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';

	const api = getApiV1Client();
	const settingsHref = resolve('/settings');

	let status = $state<'working' | 'error'>('working');
	let message = $state('Connecting your mailbox…');

	onMount(() => {
		void (async () => {
			const params = page.url.searchParams;
			const error = params.get('error')?.trim();
			const errorDescription = params.get('error_description')?.trim();
			if (error) {
				status = 'error';
				message = errorDescription || error || 'Mailbox connect was cancelled.';
				return;
			}

			const code = params.get('code')?.trim() ?? '';
			const stateParam = params.get('state')?.trim() ?? '';
			if (!code || !stateParam) {
				status = 'error';
				message = 'Missing OAuth code or state — start connect again from Mail settings.';
				return;
			}

			try {
				await api.mailbox.completeOAuth({ code, state: stateParam });
				await goto(settingsHref, { replaceState: true });
				window.location.hash = 'mail';
			} catch (err) {
				status = 'error';
				message = isApiClientError(err)
					? err.message
					: 'Could not finish mailbox connect. Try again from Mail settings.';
			}
		})();
	});
</script>

<main class="bg-background text-foreground flex min-h-svh items-center justify-center p-6">
	<div class="max-w-md space-y-3 text-center" data-testid="mailbox-oauth-callback">
		<p class="font-medium">
			{status === 'working' ? 'Finishing mailbox connect' : 'Mailbox connect failed'}
		</p>
		<p class="text-muted-foreground text-sm" role={status === 'error' ? 'alert' : 'status'}>
			{message}
		</p>
		{#if status === 'error'}
			<a class="text-sm underline" href={settingsHref}>Back to Mail settings</a>
		{/if}
	</div>
</main>

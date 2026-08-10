<script lang="ts">
	import { authCallbackUrl, getAuthSession, safeNextPath } from '$lib/auth/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';

	export interface AuthProviderOptionsProps {
		next?: string;
	}

	let { next = '/' }: AuthProviderOptionsProps = $props();

	const auth = getAuthSession();
	const safeNext = $derived(safeNextPath(next));
	let domain = $state('');
	let pending = $state<'google' | 'azure' | 'sso' | null>(null);
	let errorMessage = $state<string | null>(null);

	function callbackUrl(): string {
		return authCallbackUrl(window.location.origin, safeNext);
	}

	async function signInWithProvider(provider: 'google' | 'azure'): Promise<void> {
		errorMessage = null;
		pending = provider;
		try {
			const result = await auth.signInWithOAuth(provider, callbackUrl());
			errorMessage = result.error;
		} catch {
			errorMessage = 'Could not start sign in';
		} finally {
			pending = null;
		}
	}

	async function signInWithSSO(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		errorMessage = null;
		const normalizedDomain = domain.trim().toLowerCase();
		if (
			!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(
				normalizedDomain
			)
		) {
			errorMessage = 'Enter your company domain, such as example.com';
			return;
		}

		pending = 'sso';
		try {
			const result = await auth.signInWithSSO(normalizedDomain, callbackUrl());
			errorMessage = result.error;
		} catch {
			errorMessage = 'Could not start enterprise SSO';
		} finally {
			pending = null;
		}
	}
</script>

<div class="space-y-4">
	{#if errorMessage}
		<p class="text-sm text-destructive" role="alert">{errorMessage}</p>
	{/if}

	<div class="grid gap-2 sm:grid-cols-2">
		<Button
			type="button"
			variant="outline"
			class="w-full"
			disabled={pending !== null}
			onclick={() => signInWithProvider('google')}
		>
			{pending === 'google' ? 'Connecting…' : 'Continue with Google'}
		</Button>
		<Button
			type="button"
			variant="outline"
			class="w-full"
			disabled={pending !== null}
			onclick={() => signInWithProvider('azure')}
		>
			{pending === 'azure' ? 'Connecting…' : 'Continue with Microsoft'}
		</Button>
	</div>

	<div class="flex items-center gap-3" aria-hidden="true">
		<Separator class="flex-1" />
		<span class="text-xs text-muted-foreground uppercase">or use SSO</span>
		<Separator class="flex-1" />
	</div>

	<form class="space-y-2" onsubmit={signInWithSSO}>
		<Label for="auth-sso-domain">Company domain</Label>
		<div class="flex gap-2">
			<Input
				id="auth-sso-domain"
				name="domain"
				type="text"
				autocomplete="organization"
				autocapitalize="none"
				placeholder="example.com"
				bind:value={domain}
				disabled={pending !== null}
			/>
			<Button type="submit" variant="secondary" disabled={pending !== null}>
				{pending === 'sso' ? 'Connecting…' : 'Continue'}
			</Button>
		</div>
	</form>

	<div class="flex items-center gap-3" aria-hidden="true">
		<Separator class="flex-1" />
		<span class="text-xs text-muted-foreground uppercase">or use email</span>
		<Separator class="flex-1" />
	</div>
</div>

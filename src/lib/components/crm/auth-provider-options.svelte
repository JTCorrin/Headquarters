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
		<span class="text-xs text-muted-foreground uppercase">or continue with</span>
		<Separator class="flex-1" />
	</div>

	<div class="grid gap-2 sm:grid-cols-2">
		<Button
			type="button"
			variant="outline"
			class="w-full"
			disabled={pending !== null}
			onclick={() => signInWithProvider('google')}
		>
			<svg class="size-4" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
				<path
					fill="#4285F4"
					d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
				/>
				<path
					fill="#34A853"
					d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
				/>
				<path
					fill="#FBBC05"
					d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
				/>
				<path
					fill="#EA4335"
					d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
				/>
			</svg>
			{pending === 'google' ? 'Connecting…' : 'Continue with Google'}
		</Button>
		<Button
			type="button"
			variant="outline"
			class="w-full"
			disabled={pending !== null}
			onclick={() => signInWithProvider('azure')}
		>
			<svg class="size-4" viewBox="0 0 21 21" aria-hidden="true" focusable="false">
				<path fill="#f25022" d="M1 1h9v9H1z" />
				<path fill="#00a4ef" d="M11 1h9v9h-9z" />
				<path fill="#7fba00" d="M1 11h9v9H1z" />
				<path fill="#ffb900" d="M11 11h9v9h-9z" />
			</svg>
			{pending === 'azure' ? 'Connecting…' : 'Continue with Microsoft'}
		</Button>
	</div>
</div>

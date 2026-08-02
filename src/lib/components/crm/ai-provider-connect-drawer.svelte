<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { untrack } from 'svelte';
	import {
		aiProviderConnectSchema,
		aiProviderHints,
		aiProviderLabels,
		type AiProvider
	} from '$lib/schemas/integration.js';
	import * as Drawer from '$lib/components/ui/drawer/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { cn } from '$lib/utils.js';

	export interface AiProviderConnectDrawerProps {
		provider: AiProvider | null;
		open?: boolean;
		connectError?: string | null;
		class?: string;
		/**
		 * Called with the API key after validation.
		 * Return `false` or reject to keep the drawer open.
		 */
		onConnect?: (apiKey: string) => boolean | void | Promise<boolean | void>;
	}

	let {
		provider,
		open = $bindable(false),
		connectError = null,
		class: className,
		onConnect
	}: AiProviderConnectDrawerProps = $props();

	const form = superForm(defaults({ apiKey: '' }, zod4(aiProviderConnectSchema)), {
		validators: zod4(aiProviderConnectSchema),
		SPA: true,
		warnings: { duplicateId: false },
		applyAction: false,
		resetForm: false
	});

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	let pending = $state(false);
	let localError = $state<string | null>(null);
	let submitLock = false;
	const busy = $derived($submitting || pending);
	const displayError = $derived(connectError ?? localError);
	const title = $derived(provider ? `Connect ${aiProviderLabels[provider]}` : 'Connect AI');
	const hint = $derived(provider ? aiProviderHints[provider] : '');

	$effect(() => {
		if (open) {
			formData.update((current) => ({ ...current, apiKey: '' }));
			localError = null;
		}
	});

	async function handleSubmit(): Promise<boolean> {
		localError = null;
		try {
			const key = $formData.apiKey.trim();
			const result = await onConnect?.(key);
			if (result === false) {
				if (!connectError && !localError) {
					localError = 'Could not connect — check the key and try again.';
				}
				return false;
			}
			open = false;
			return true;
		} catch (err) {
			localError =
				err instanceof Error ? err.message : 'Could not connect — check the key and try again.';
			return false;
		}
	}
</script>

<Drawer.Root bind:open direction="right" shouldScaleBackground={false}>
	<Drawer.Content
		class={cn('mx-auto w-full max-w-md', className)}
		data-testid="ai-provider-connect-drawer"
	>
		<Drawer.Header class="text-left">
			<Drawer.Title>{title}</Drawer.Title>
			<Drawer.Description>
				{hint} Keys are stored write-only — Headquarters never shows them again after save.
			</Drawer.Description>
		</Drawer.Header>
		<form
			method="POST"
			class="space-y-4 px-4 pb-6"
			data-testid="ai-provider-connect-form"
			use:enhance={{
				async onUpdate({ form: validated }) {
					if (!validated.valid) return;
					if (submitLock) return false;
					submitLock = true;
					pending = true;
					try {
						return await handleSubmit();
					} catch {
						return false;
					} finally {
						submitLock = false;
						pending = false;
					}
				}
			}}
		>
			{#if displayError}
				<p class="text-destructive text-sm" role="alert" data-testid="ai-provider-connect-error">
					{displayError}
				</p>
			{/if}
			<div class="space-y-2">
				<Label for="ai-api-key">API key</Label>
				<Input
					id="ai-api-key"
					name="apiKey"
					type="password"
					autocomplete="off"
					bind:value={$formData.apiKey}
					disabled={busy || !provider}
					placeholder="sk-…"
					data-testid="ai-api-key"
				/>
				{#if $errors.apiKey}
					<p class="text-destructive text-xs">{$errors.apiKey}</p>
				{/if}
			</div>
			<div class="flex justify-end gap-2">
				<Button type="button" variant="ghost" disabled={busy} onclick={() => (open = false)}>
					Cancel
				</Button>
				<Button type="submit" disabled={busy || !provider} data-testid="ai-provider-connect-submit">
					{busy ? 'Connecting…' : 'Save key'}
				</Button>
			</div>
		</form>
	</Drawer.Content>
</Drawer.Root>

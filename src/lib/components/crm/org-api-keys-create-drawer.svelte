<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { untrack } from 'svelte';
	import {
		apiKeyCreateSchema,
		apiKeyRoleLabel,
		apiKeyRoleOptions,
		type ApiKeyCreateData
	} from '$lib/schemas/api-key.js';
	import type { MembershipRole } from '$lib/schemas/organisation.js';
	import * as Drawer from '$lib/components/ui/drawer/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { cn } from '$lib/utils.js';

	export interface OrgApiKeysCreateDrawerProps {
		actorRole: MembershipRole;
		open?: boolean;
		createError?: string | null;
		/** Reveal-once secret after a successful create. */
		revealedSecret?: string | null;
		class?: string;
		onCreate?: (
			input: ApiKeyCreateData
		) => boolean | void | Promise<boolean | void>;
		onDismissSecret?: () => void;
	}

	let {
		actorRole,
		open = $bindable(false),
		createError = null,
		revealedSecret = null,
		class: className,
		onCreate,
		onDismissSecret
	}: OrgApiKeysCreateDrawerProps = $props();

	const roleOptions = $derived(apiKeyRoleOptions(actorRole));

	const form = superForm(
		defaults({ name: '', role: 'member' satisfies MembershipRole }, zod4(apiKeyCreateSchema)),
		{
			validators: zod4(apiKeyCreateSchema),
			SPA: true,
			warnings: { duplicateId: false },
			applyAction: false,
			resetForm: false
		}
	);

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	let pending = $state(false);
	let localError = $state<string | null>(null);
	let copied = $state(false);
	const busy = $derived($submitting || pending);
	const displayError = $derived(createError ?? localError);
	const roleLabelText = $derived(apiKeyRoleLabel($formData.role));
	const showingSecret = $derived(Boolean(revealedSecret));

	$effect(() => {
		if (open && !revealedSecret) {
			const defaultRole = roleOptions.includes('member') ? 'member' : roleOptions[0]!;
			formData.update((current) => ({ ...current, name: '', role: defaultRole }));
			localError = null;
			copied = false;
		}
	});

	async function handleSubmit(): Promise<boolean> {
		localError = null;
		pending = true;
		try {
			const input: ApiKeyCreateData = {
				name: $formData.name.trim(),
				role: $formData.role
			};
			const result = await onCreate?.(input);
			if (result === false) {
				if (!createError && !localError) {
					localError = 'Could not create API key.';
				}
				return false;
			}
			return true;
		} catch (err) {
			localError = err instanceof Error ? err.message : 'Could not create API key.';
			return false;
		} finally {
			pending = false;
		}
	}

	async function copySecret() {
		if (!revealedSecret) return;
		try {
			await navigator.clipboard.writeText(revealedSecret);
			copied = true;
		} catch {
			copied = false;
		}
	}

	function closeAfterReveal() {
		onDismissSecret?.();
		open = false;
		copied = false;
	}
</script>

<Drawer.Root bind:open direction="right" shouldScaleBackground={false}>
	<Drawer.Content
		class={cn('mx-auto w-full max-w-md', className)}
		data-testid="org-api-keys-create-drawer"
	>
		{#if showingSecret}
			<Drawer.Header class="text-left">
				<Drawer.Title>Copy your API key</Drawer.Title>
				<Drawer.Description>
					This secret is shown once. Paste it into your agent host (Buzz, Cursor, Claude Desktop)
					and store it safely — Headquarters will not display it again.
				</Drawer.Description>
			</Drawer.Header>
			<div class="space-y-4 px-4 pb-6" data-testid="org-api-keys-secret-reveal">
				<div class="bg-muted/60 rounded-3xl border px-3 py-3">
					<code
						class="text-foreground block break-all font-mono text-sm"
						data-testid="org-api-keys-secret-value">{revealedSecret}</code
					>
				</div>
				<div class="flex flex-wrap gap-2">
					<Button type="button" data-testid="org-api-keys-copy-secret" onclick={copySecret}>
						{copied ? 'Copied' : 'Copy secret'}
					</Button>
					<Button
						type="button"
						variant="outline"
						data-testid="org-api-keys-dismiss-secret"
						onclick={closeAfterReveal}
					>
						Done
					</Button>
				</div>
			</div>
		{:else}
			<Drawer.Header class="text-left">
				<Drawer.Title>Create API key</Drawer.Title>
				<Drawer.Description>
					Mint an org-scoped key for agents and scripts. The key inherits the role you choose —
					never stronger than your own.
				</Drawer.Description>
			</Drawer.Header>
			<form
				method="POST"
				class="space-y-4 px-4 pb-6"
				data-testid="org-api-keys-create-form"
				use:enhance={{
					onSubmit: async ({ cancel }) => {
						cancel();
						if (busy) return;
						await handleSubmit();
					}
				}}
			>
				<div class="space-y-2">
					<Label for="api-key-name">Name</Label>
					<Input
						id="api-key-name"
						name="name"
						bind:value={$formData.name}
						placeholder="Buzz agent"
						aria-invalid={!!$errors.name}
						data-testid="org-api-keys-name"
					/>
					{#if $errors.name}
						<p class="text-destructive text-xs">{$errors.name}</p>
					{/if}
				</div>

				<div class="space-y-2">
					<Label for="api-key-role">Role</Label>
					<Select.Root
						type="single"
						value={$formData.role}
						onValueChange={(value) => {
							if (value && roleOptions.includes(value as MembershipRole)) {
								$formData.role = value as MembershipRole;
							}
						}}
					>
						<Select.Trigger id="api-key-role" aria-label="Role" data-testid="org-api-keys-role">
							{roleLabelText}
						</Select.Trigger>
						<Select.Content>
							{#each roleOptions as role (role)}
								<Select.Item value={role} label={apiKeyRoleLabel(role)}>
									{apiKeyRoleLabel(role)}
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				{#if displayError}
					<p class="text-destructive text-sm" role="alert" data-testid="org-api-keys-create-error">
						{displayError}
					</p>
				{/if}

				<div class="flex justify-end gap-2 pt-2">
					<Button
						type="button"
						variant="ghost"
						disabled={busy}
						onclick={() => {
							open = false;
						}}
					>
						Cancel
					</Button>
					<Button type="submit" disabled={busy} data-testid="org-api-keys-create-submit">
						{busy ? 'Creating…' : 'Create key'}
					</Button>
				</div>
			</form>
		{/if}
	</Drawer.Content>
</Drawer.Root>

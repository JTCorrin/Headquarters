<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import {
		themeOptions,
		type OrganisationConfigData
	} from '$lib/schemas/organisation.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { cn } from '$lib/utils.js';

	export interface OrganisationConfigFormProps {
		form: SuperForm<OrganisationConfigData>;
		readonly?: boolean;
		submitLabel?: string;
		class?: string;
		logoUrl?: string | null;
		logoBusy?: boolean;
		onUploadLogo?: (file: File) => void | Promise<void>;
		onRemoveLogo?: () => void | Promise<void>;
		/**
		 * Called after client-side validation succeeds.
		 * May return a Promise; awaited before ending pending state.
		 */
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		readonly = false,
		submitLabel = 'Save configuration',
		class: className,
		logoUrl = null,
		logoBusy = false,
		onUploadLogo,
		onRemoveLogo,
		onValidSubmit
	}: OrganisationConfigFormProps = $props();

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	/** UI busy flag (may batch); not used as the concurrency lock. */
	let pendingSubmit = $state(false);
	/** Synchronous lock — `$state` writes can batch, so they are not a re-entry guard. */
	let submitLock = false;
	const busy = $derived($submitting || pendingSubmit || logoBusy);

	const themeLabels: Record<(typeof themeOptions)[number], string> = {
		system: 'System',
		light: 'Light',
		dark: 'Dark'
	};

	const themeLabel = $derived(themeLabels[$formData.themeDefault] ?? 'Theme');

	let logoInput: HTMLInputElement | null = $state(null);

	function openLogoPicker() {
		logoInput?.click();
	}

	async function onLogoSelected(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || !onUploadLogo) return;
		await onUploadLogo(file);
	}
</script>

<form
	method="POST"
	class={cn('space-y-8', className)}
	data-testid="organisation-config-form"
	use:enhance={{
		async onUpdate({ form: validated }) {
			if (!validated.valid) return;
			// Disabled buttons are not a concurrency guard (force-click / double enter).
			if (submitLock) return false;
			submitLock = true;
			pendingSubmit = true;
			try {
				return await onValidSubmit?.();
			} catch {
				// Swallow so Superforms default onError does not rethrow.
				return false;
			} finally {
				submitLock = false;
				pendingSubmit = false;
			}
		}
	}}
>
	<!-- bits-ui Select is not a native control; keep FormData in sync for Superforms SPA. -->
	<input type="hidden" name="themeDefault" value={$formData.themeDefault} />

	<section class="space-y-4" data-testid="org-company-details-section">
		<div>
			<h3 class="text-base font-semibold tracking-tight">Company details</h3>
			<p class="text-muted-foreground text-sm">
				Shown on quotes and invoices — logo top left, address top right.
			</p>
		</div>

		<div class="flex flex-wrap items-start gap-4">
			<div
				class="bg-muted/40 flex size-24 items-center justify-center overflow-hidden rounded-2xl ring-1 ring-foreground/10"
				data-testid="org-logo-preview"
			>
				{#if logoUrl}
					<img src={logoUrl} alt="Organisation logo" class="size-full object-contain p-2" />
				{:else}
					<span class="text-muted-foreground px-2 text-center text-xs">No logo</span>
				{/if}
			</div>
			{#if !readonly}
				<div class="space-y-2">
					<input
						bind:this={logoInput}
						type="file"
						accept="image/png,image/jpeg,image/webp"
						class="hidden"
						data-testid="org-logo-input"
						onchange={onLogoSelected}
					/>
					<div class="flex flex-wrap gap-2">
						<Button
							type="button"
							size="sm"
							variant="outline"
							disabled={busy}
							data-testid="org-logo-upload"
							onclick={openLogoPicker}
						>
							{logoBusy ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload logo'}
						</Button>
						{#if logoUrl && onRemoveLogo}
							<Button
								type="button"
								size="sm"
								variant="ghost"
								disabled={busy}
								data-testid="org-logo-remove"
								onclick={() => onRemoveLogo?.()}
							>
								Remove
							</Button>
						{/if}
					</div>
					<p class="text-muted-foreground text-xs">PNG, JPEG, or WebP up to 2 MB.</p>
				</div>
			{/if}
		</div>

		<div class="grid gap-4 sm:grid-cols-2">
			<div class="space-y-2">
				<Label for="org-config-name">Display name</Label>
				<Input
					id="org-config-name"
					name="name"
					bind:value={$formData.name}
					disabled={readonly || busy}
					aria-invalid={!!$errors.name}
				/>
				{#if $errors.name}<p class="text-destructive text-xs">{$errors.name}</p>{/if}
			</div>
			<div class="space-y-2">
				<Label for="org-config-legal-name">Legal name</Label>
				<Input
					id="org-config-legal-name"
					name="legalName"
					bind:value={$formData.legalName}
					disabled={readonly || busy}
					aria-invalid={!!$errors.legalName}
				/>
				{#if $errors.legalName}<p class="text-destructive text-xs">{$errors.legalName}</p>{/if}
			</div>
		</div>

		<div class="grid gap-4 sm:grid-cols-2">
			<div class="space-y-2">
				<Label for="org-config-phone">Phone</Label>
				<Input
					id="org-config-phone"
					name="phone"
					bind:value={$formData.phone}
					disabled={readonly || busy}
					aria-invalid={!!$errors.phone}
				/>
				{#if $errors.phone}<p class="text-destructive text-xs">{$errors.phone}</p>{/if}
			</div>
			<div class="space-y-2">
				<Label for="org-config-billing-email">Billing email</Label>
				<Input
					id="org-config-billing-email"
					name="billingEmail"
					type="email"
					bind:value={$formData.billingEmail}
					disabled={readonly || busy}
					aria-invalid={!!$errors.billingEmail}
				/>
				{#if $errors.billingEmail}
					<p class="text-destructive text-xs">{$errors.billingEmail}</p>
				{/if}
			</div>
		</div>

		<div class="grid gap-4 sm:grid-cols-2">
			<div class="space-y-2">
				<Label for="org-config-website">Website</Label>
				<Input
					id="org-config-website"
					name="websiteUrl"
					bind:value={$formData.websiteUrl}
					disabled={readonly || busy}
					aria-invalid={!!$errors.websiteUrl}
				/>
				{#if $errors.websiteUrl}<p class="text-destructive text-xs">{$errors.websiteUrl}</p>{/if}
			</div>
			<div class="space-y-2">
				<Label for="org-config-country">Country</Label>
				<Input
					id="org-config-country"
					name="country"
					bind:value={$formData.country}
					disabled={readonly || busy}
					aria-invalid={!!$errors.country}
					placeholder="GB"
				/>
				{#if $errors.country}<p class="text-destructive text-xs">{$errors.country}</p>{/if}
			</div>
		</div>

		<div class="grid gap-4 sm:grid-cols-2">
			<div class="space-y-2">
				<Label for="org-config-tax-id">Tax identifier</Label>
				<Input
					id="org-config-tax-id"
					name="taxIdentifier"
					bind:value={$formData.taxIdentifier}
					disabled={readonly || busy}
					aria-invalid={!!$errors.taxIdentifier}
				/>
				{#if $errors.taxIdentifier}
					<p class="text-destructive text-xs">{$errors.taxIdentifier}</p>
				{/if}
			</div>
			<div class="space-y-2">
				<Label for="org-config-reg-number">Registration number</Label>
				<Input
					id="org-config-reg-number"
					name="registrationNumber"
					bind:value={$formData.registrationNumber}
					disabled={readonly || busy}
					aria-invalid={!!$errors.registrationNumber}
				/>
				{#if $errors.registrationNumber}
					<p class="text-destructive text-xs">{$errors.registrationNumber}</p>
				{/if}
			</div>
		</div>

		<div class="space-y-2">
			<Label for="org-config-address1">Address line 1</Label>
			<Input
				id="org-config-address1"
				name="addressLine1"
				bind:value={$formData.addressLine1}
				disabled={readonly || busy}
				aria-invalid={!!$errors.addressLine1}
			/>
			{#if $errors.addressLine1}<p class="text-destructive text-xs">{$errors.addressLine1}</p>{/if}
		</div>
		<div class="space-y-2">
			<Label for="org-config-address2">Address line 2</Label>
			<Input
				id="org-config-address2"
				name="addressLine2"
				bind:value={$formData.addressLine2}
				disabled={readonly || busy}
				aria-invalid={!!$errors.addressLine2}
			/>
			{#if $errors.addressLine2}<p class="text-destructive text-xs">{$errors.addressLine2}</p>{/if}
		</div>
		<div class="grid gap-4 sm:grid-cols-3">
			<div class="space-y-2">
				<Label for="org-config-city">City</Label>
				<Input
					id="org-config-city"
					name="city"
					bind:value={$formData.city}
					disabled={readonly || busy}
					aria-invalid={!!$errors.city}
				/>
				{#if $errors.city}<p class="text-destructive text-xs">{$errors.city}</p>{/if}
			</div>
			<div class="space-y-2">
				<Label for="org-config-region">Region / state</Label>
				<Input
					id="org-config-region"
					name="region"
					bind:value={$formData.region}
					disabled={readonly || busy}
					aria-invalid={!!$errors.region}
				/>
				{#if $errors.region}<p class="text-destructive text-xs">{$errors.region}</p>{/if}
			</div>
			<div class="space-y-2">
				<Label for="org-config-postal">Postal code</Label>
				<Input
					id="org-config-postal"
					name="postalCode"
					bind:value={$formData.postalCode}
					disabled={readonly || busy}
					aria-invalid={!!$errors.postalCode}
				/>
				{#if $errors.postalCode}<p class="text-destructive text-xs">{$errors.postalCode}</p>{/if}
			</div>
		</div>
	</section>

	<section class="space-y-4" data-testid="org-defaults-fields-section">
		<div>
			<h3 class="text-base font-semibold tracking-tight">Defaults</h3>
			<p class="text-muted-foreground text-sm">Timezone, currency, locale, and theme.</p>
		</div>
		<div class="grid gap-4 sm:grid-cols-2">
			<div class="space-y-2">
				<Label for="org-config-timezone">Timezone</Label>
				<Input
					id="org-config-timezone"
					name="timezone"
					bind:value={$formData.timezone}
					disabled={readonly || busy}
					aria-invalid={!!$errors.timezone}
				/>
				{#if $errors.timezone}<p class="text-destructive text-xs">{$errors.timezone}</p>{/if}
			</div>
			<div class="space-y-2">
				<Label for="org-config-currency">Default currency</Label>
				<Input
					id="org-config-currency"
					name="currency"
					bind:value={$formData.currency}
					disabled={readonly || busy}
					aria-invalid={!!$errors.currency}
				/>
				{#if $errors.currency}<p class="text-destructive text-xs">{$errors.currency}</p>{/if}
			</div>
		</div>

		<div class="grid gap-4 sm:grid-cols-2">
			<div class="space-y-2">
				<Label for="org-config-locale">Locale</Label>
				<Input
					id="org-config-locale"
					name="locale"
					bind:value={$formData.locale}
					disabled={readonly || busy}
					aria-invalid={!!$errors.locale}
				/>
				{#if $errors.locale}<p class="text-destructive text-xs">{$errors.locale}</p>{/if}
			</div>
			<div class="space-y-2">
				<Label for="org-config-theme">Organisation theme</Label>
				{#if readonly}
					<Input id="org-config-theme" value={themeLabel} disabled />
				{:else}
					<Select.Root type="single" bind:value={$formData.themeDefault} disabled={busy}>
						<Select.Trigger
							id="org-config-theme"
							class="w-full"
							disabled={busy}
							data-testid="organisation-theme-trigger"
						>
							{themeLabel}
						</Select.Trigger>
						<Select.Content>
							{#each themeOptions as option (option)}
								<Select.Item value={option} label={themeLabels[option]}
									>{themeLabels[option]}</Select.Item
								>
							{/each}
						</Select.Content>
					</Select.Root>
				{/if}
			</div>
		</div>
	</section>

	{#if !readonly}
		<div class="flex justify-end">
			<Button type="submit" disabled={busy} data-testid="organisation-config-submit">
				{busy ? 'Saving…' : submitLabel}
			</Button>
		</div>
	{/if}
</form>

<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import {
		applyMailboxPreset,
		formatMailboxLastChecked,
		humanizeMailboxSyncError,
		mailboxPresets,
		mailboxSecurityOptions,
		type MailboxAccountResource,
		type MailboxFormData,
		type MailboxPreset
	} from '$lib/schemas/mailbox.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { cn } from '$lib/utils.js';

	export interface ProfileMailboxFormProps {
		form: SuperForm<MailboxFormData>;
		account?: MailboxAccountResource | null;
		submitLabel?: string;
		class?: string;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
		onTest?: () => boolean | void | Promise<boolean | void>;
		onDisconnect?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		account = null,
		submitLabel = 'Save mailbox',
		class: className,
		onValidSubmit,
		onTest,
		onDisconnect
	}: ProfileMailboxFormProps = $props();

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	let pendingSubmit = $state(false);
	let pendingTest = $state(false);
	let pendingDisconnect = $state(false);
	let submitLock = false;
	const busy = $derived($submitting || pendingSubmit || pendingTest || pendingDisconnect);

	const presetLabels: Record<MailboxPreset, string> = {
		gmail: 'Gmail',
		outlook: 'Outlook / Microsoft 365',
		custom: 'Custom'
	};

	const securityLabels: Record<(typeof mailboxSecurityOptions)[number], string> = {
		tls: 'SSL/TLS',
		starttls: 'STARTTLS',
		none: 'None'
	};

	const presetLabel = $derived(presetLabels[$formData.preset] ?? 'Preset');
	const imapSecurityLabel = $derived(securityLabels[$formData.imapSecurity] ?? 'Security');
	const smtpSecurityLabel = $derived(securityLabels[$formData.smtpSecurity] ?? 'Security');

	let lastAppliedPreset = $state<MailboxPreset | null>(null);

	$effect(() => {
		const preset = $formData.preset;
		if (lastAppliedPreset === null) {
			lastAppliedPreset = preset;
			return;
		}
		if (preset === lastAppliedPreset) return;
		lastAppliedPreset = preset;
		formData.update((current) => applyMailboxPreset(current, preset));
	});

	async function handleTest() {
		if (pendingTest || !onTest) return;
		pendingTest = true;
		try {
			await onTest();
		} finally {
			pendingTest = false;
		}
	}

	async function handleDisconnect() {
		if (pendingDisconnect || !onDisconnect) return;
		pendingDisconnect = true;
		try {
			await onDisconnect();
		} finally {
			pendingDisconnect = false;
		}
	}
</script>

<form
	method="POST"
	class={cn('space-y-4', className)}
	data-testid="profile-mailbox-form"
	use:enhance={{
		async onUpdate({ form: validated }) {
			if (!validated.valid) return;
			if (submitLock) return false;
			submitLock = true;
			pendingSubmit = true;
			try {
				return await onValidSubmit?.();
			} catch {
				return false;
			} finally {
				submitLock = false;
				pendingSubmit = false;
			}
		}
	}}
>
	<input type="hidden" name="preset" value={$formData.preset} />
	<input type="hidden" name="imapSecurity" value={$formData.imapSecurity} />
	<input type="hidden" name="smtpSecurity" value={$formData.smtpSecurity} />

	<div class="rounded-2xl bg-muted/40 px-3 py-3 text-xs leading-relaxed">
		<p class="text-foreground font-medium">Personal mailbox</p>
		<p class="text-muted-foreground mt-1">
			Connect your own IMAP/SMTP so contact, lead, and client Email tabs can show mail to and from
			this address. This is separate from organisation Email sending (quotes, invoices, campaigns)
			under Org → Integrations.
		</p>
	</div>

	{#if account?.credentials_configured}
		<p class="text-muted-foreground text-xs" data-testid="mailbox-credentials-saved">
			Password saved — leave blank to keep it, or enter a new one to replace.
		</p>
	{/if}

	{#if account?.last_checked_at || account?.last_error_code}
		<p class="text-muted-foreground text-xs" data-testid="mailbox-sync-status">
			{#if account.last_checked_at}
				Last checked {formatMailboxLastChecked(account.last_checked_at)}.
			{/if}
			{#if account.last_error_code}
				<span class="text-destructive">
					{formatMailboxLastChecked(account.last_checked_at) ? ' ' : ''}{humanizeMailboxSyncError(
						account.last_error_code
					)}
				</span>
			{/if}
		</p>
	{/if}

	<div class="space-y-2">
		<Label for="mailbox-preset">Provider preset</Label>
		<Select.Root type="single" bind:value={$formData.preset} disabled={busy}>
			<Select.Trigger id="mailbox-preset" class="w-full" data-testid="mailbox-preset-trigger" disabled={busy}>
				{presetLabel}
			</Select.Trigger>
			<Select.Content>
				{#each mailboxPresets as option (option)}
					<Select.Item value={option} label={presetLabels[option]}>{presetLabels[option]}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2 sm:col-span-2">
			<Label for="mailbox-email">Email address</Label>
			<Input
				id="mailbox-email"
				name="emailAddress"
				type="email"
				bind:value={$formData.emailAddress}
				disabled={busy}
				data-testid="mailbox-email"
			/>
			{#if $errors.emailAddress}
				<p class="text-destructive text-xs">{$errors.emailAddress}</p>
			{/if}
		</div>
		<div class="space-y-2">
			<Label for="mailbox-username">Username</Label>
			<Input
				id="mailbox-username"
				name="username"
				bind:value={$formData.username}
				disabled={busy}
				placeholder="Usually the same as email"
				data-testid="mailbox-username"
			/>
		</div>
		<div class="space-y-2">
			<Label for="mailbox-password">Password / app password</Label>
			<Input
				id="mailbox-password"
				name="password"
				type="password"
				autocomplete="new-password"
				bind:value={$formData.password}
				disabled={busy}
				placeholder={account?.credentials_configured ? '••••••••' : 'App password'}
				data-testid="mailbox-password"
			/>
			<p class="text-muted-foreground text-xs">Write-only — never shown after save.</p>
		</div>
		<div class="space-y-2 sm:col-span-2">
			<Label for="mailbox-from-name">From name</Label>
			<Input
				id="mailbox-from-name"
				name="fromName"
				bind:value={$formData.fromName}
				disabled={busy}
				data-testid="mailbox-from-name"
			/>
		</div>
	</div>

	<div class="grid gap-4 sm:grid-cols-3">
		<div class="space-y-2 sm:col-span-2">
			<Label for="mailbox-imap-host">IMAP host</Label>
			<Input
				id="mailbox-imap-host"
				name="imapHost"
				bind:value={$formData.imapHost}
				disabled={busy}
				data-testid="mailbox-imap-host"
			/>
		</div>
		<div class="space-y-2">
			<Label for="mailbox-imap-port">IMAP port</Label>
			<Input
				id="mailbox-imap-port"
				name="imapPort"
				bind:value={$formData.imapPort}
				disabled={busy}
				data-testid="mailbox-imap-port"
			/>
		</div>
		<div class="space-y-2 sm:col-span-3">
			<Label for="mailbox-imap-security">IMAP security</Label>
			<Select.Root type="single" bind:value={$formData.imapSecurity} disabled={busy}>
				<Select.Trigger id="mailbox-imap-security" class="w-full" disabled={busy}>
					{imapSecurityLabel}
				</Select.Trigger>
				<Select.Content>
					{#each mailboxSecurityOptions as option (option)}
						<Select.Item value={option} label={securityLabels[option]}
							>{securityLabels[option]}</Select.Item
						>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	</div>

	<div class="grid gap-4 sm:grid-cols-3">
		<div class="space-y-2 sm:col-span-2">
			<Label for="mailbox-smtp-host">SMTP host</Label>
			<Input
				id="mailbox-smtp-host"
				name="smtpHost"
				bind:value={$formData.smtpHost}
				disabled={busy}
				data-testid="mailbox-smtp-host"
			/>
		</div>
		<div class="space-y-2">
			<Label for="mailbox-smtp-port">SMTP port</Label>
			<Input
				id="mailbox-smtp-port"
				name="smtpPort"
				bind:value={$formData.smtpPort}
				disabled={busy}
				data-testid="mailbox-smtp-port"
			/>
		</div>
		<div class="space-y-2 sm:col-span-3">
			<Label for="mailbox-smtp-security">SMTP security</Label>
			<Select.Root type="single" bind:value={$formData.smtpSecurity} disabled={busy}>
				<Select.Trigger id="mailbox-smtp-security" class="w-full" disabled={busy}>
					{smtpSecurityLabel}
				</Select.Trigger>
				<Select.Content>
					{#each mailboxSecurityOptions as option (option)}
						<Select.Item value={option} label={securityLabels[option]}
							>{securityLabels[option]}</Select.Item
						>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	</div>

	<div class="flex flex-wrap justify-end gap-2">
		{#if account && onDisconnect}
			<Button
				type="button"
				variant="ghost"
				disabled={busy}
				onclick={handleDisconnect}
				data-testid="mailbox-disconnect"
			>
				{pendingDisconnect ? 'Disconnecting…' : 'Disconnect'}
			</Button>
		{/if}
		{#if onTest}
			<Button
				type="button"
				variant="outline"
				disabled={busy || !account?.credentials_configured}
				onclick={handleTest}
				data-testid="mailbox-test"
			>
				{pendingTest ? 'Testing…' : 'Test connection'}
			</Button>
		{/if}
		<Button type="submit" disabled={busy} data-testid="mailbox-submit">
			{pendingSubmit || $submitting ? 'Saving…' : submitLabel}
		</Button>
	</div>
</form>

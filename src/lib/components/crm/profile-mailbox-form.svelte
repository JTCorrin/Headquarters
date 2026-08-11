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
		type MailboxPreset,
		type MailboxTestFeedback
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
		oauthError?: string | null;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
		onConnectOAuth?: (
			provider: 'microsoft' | 'google'
		) => boolean | void | Promise<boolean | void>;
		onTest?: () => MailboxTestFeedback | false | void | Promise<MailboxTestFeedback | false | void>;
		onSync?: () => MailboxTestFeedback | false | void | Promise<MailboxTestFeedback | false | void>;
		onDisconnect?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		account = null,
		submitLabel = 'Save mailbox',
		class: className,
		oauthError = null,
		onValidSubmit,
		onConnectOAuth,
		onTest,
		onSync,
		onDisconnect
	}: ProfileMailboxFormProps = $props();

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	let pendingSubmit = $state(false);
	let pendingTest = $state(false);
	let pendingSync = $state(false);
	let pendingDisconnect = $state(false);
	let pendingOAuth = $state(false);
	let testFeedback = $state<MailboxTestFeedback | null>(null);
	let syncFeedback = $state<MailboxTestFeedback | null>(null);
	let submitLock = false;
	const busy = $derived(
		$submitting ||
			pendingSubmit ||
			pendingTest ||
			pendingSync ||
			pendingDisconnect ||
			pendingOAuth
	);

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

	const oauthPreset = $derived(
		$formData.preset === 'outlook' || $formData.preset === 'gmail' ? $formData.preset : null
	);
	const oauthProvider = $derived<'microsoft' | 'google' | null>(
		oauthPreset === 'outlook' ? 'microsoft' : oauthPreset === 'gmail' ? 'google' : null
	);
	const oauthConnected = $derived(
		Boolean(
			account?.credentials_configured &&
				account.auth_mode === 'oauth' &&
				((oauthProvider === 'microsoft' && account.oauth_provider === 'microsoft') ||
					(oauthProvider === 'google' && account.oauth_provider === 'google') ||
					(!oauthProvider && account.oauth_provider))
		)
	);
	const showPasswordForm = $derived($formData.preset === 'custom');
	const connectLabel = $derived(
		oauthProvider === 'microsoft' ? 'Connect with Microsoft' : 'Connect with Google'
	);

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
		testFeedback = null;
		try {
			const result = await onTest();
			if (result && typeof result === 'object' && 'ok' in result) {
				testFeedback = result;
			}
		} finally {
			pendingTest = false;
		}
	}

	async function handleSync() {
		if (pendingSync || !onSync) return;
		pendingSync = true;
		syncFeedback = null;
		try {
			const result = await onSync();
			if (result && typeof result === 'object' && 'ok' in result) {
				syncFeedback = result;
			}
		} finally {
			pendingSync = false;
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

	async function handleConnectOAuth() {
		if (pendingOAuth || !onConnectOAuth || !oauthProvider) return;
		pendingOAuth = true;
		try {
			await onConnectOAuth(oauthProvider);
		} finally {
			pendingOAuth = false;
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
			this address. Outlook and Gmail use one-click OAuth. Custom providers still use a password or
			app password. This is separate from organisation Email sending under Org → Integrations.
		</p>
	</div>

	{#if account?.credentials_configured && account.auth_mode === 'password'}
		<p class="text-muted-foreground text-xs" data-testid="mailbox-credentials-saved">
			Password saved — leave blank to keep it, or enter a new one to replace.
		</p>
	{/if}

	{#if account?.credentials_configured && account.auth_mode === 'oauth'}
		<p class="text-muted-foreground text-xs" data-testid="mailbox-oauth-connected">
			Connected via {account.oauth_provider === 'microsoft' ? 'Microsoft' : 'Google'} as
			{account.email_address}.
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

	{#if oauthProvider}
		{#if oauthError}
			<p class="text-destructive text-sm" role="alert" data-testid="mailbox-oauth-error">
				{oauthError}
			</p>
		{/if}

		{#if !oauthConnected}
			<div class="flex flex-wrap gap-2">
				<Button
					type="button"
					disabled={busy || !onConnectOAuth}
					onclick={handleConnectOAuth}
					data-testid="mailbox-oauth-connect"
				>
					{pendingOAuth ? 'Redirecting…' : connectLabel}
				</Button>
			</div>
			<p class="text-muted-foreground text-xs">
				You’ll sign in with {oauthProvider === 'microsoft' ? 'Microsoft' : 'Google'} and return here.
				IMAP must be enabled in your provider account settings.
			</p>
		{/if}
	{/if}

	{#if showPasswordForm}
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
	{/if}

	{#if testFeedback}
		<p
			class={cn(
				'rounded-2xl px-3 py-2 text-xs',
				testFeedback.ok
					? 'bg-emerald-500/10 text-emerald-900 ring-1 ring-emerald-500/20 dark:text-emerald-100'
					: 'bg-destructive/10 text-destructive ring-1 ring-destructive/20'
			)}
			role="status"
			data-testid="mailbox-test-feedback"
		>
			{testFeedback.message}
		</p>
	{/if}

	{#if syncFeedback}
		<p
			class={cn(
				'rounded-2xl px-3 py-2 text-xs',
				syncFeedback.ok
					? 'bg-emerald-500/10 text-emerald-900 ring-1 ring-emerald-500/20 dark:text-emerald-100'
					: 'bg-destructive/10 text-destructive ring-1 ring-destructive/20'
			)}
			role="status"
			data-testid="mailbox-sync-feedback"
		>
			{syncFeedback.message}
		</p>
	{/if}

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
		{#if onSync}
			<Button
				type="button"
				variant="outline"
				disabled={busy || !account?.credentials_configured}
				onclick={handleSync}
				data-testid="mailbox-sync"
			>
				{pendingSync ? 'Syncing…' : 'Sync now'}
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
		{#if showPasswordForm}
			<Button type="submit" disabled={busy} data-testid="mailbox-submit">
				{pendingSubmit || $submitting ? 'Saving…' : submitLabel}
			</Button>
		{/if}
	</div>
</form>

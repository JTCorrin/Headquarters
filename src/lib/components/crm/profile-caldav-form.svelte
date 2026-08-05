<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import {
		calendarConnectionLabel,
		type CaldavFormData,
		type CaldavTestFeedback,
		type CalendarConnectionResource
	} from '$lib/schemas/calendar-connection.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import StatusBadge from './status-badge.svelte';
	import { cn } from '$lib/utils.js';

	export interface ProfileCaldavFormProps {
		form: SuperForm<CaldavFormData>;
		connection?: CalendarConnectionResource | null;
		/** True when Google (or another provider) is the active push connection (XOR). */
		otherProviderActive?: boolean;
		connectError?: string | null;
		canEdit?: boolean;
		submitLabel?: string;
		class?: string;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
		onTest?: () => CaldavTestFeedback | false | void | Promise<CaldavTestFeedback | false | void>;
		onDisconnect?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		connection = null,
		otherProviderActive = false,
		connectError = null,
		canEdit = true,
		submitLabel = 'Save CalDAV',
		class: className,
		onValidSubmit,
		onTest,
		onDisconnect
	}: ProfileCaldavFormProps = $props();

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	let pendingSubmit = $state(false);
	let pendingTest = $state(false);
	let pendingDisconnect = $state(false);
	let testFeedback = $state<CaldavTestFeedback | null>(null);
	let submitLock = false;
	const busy = $derived($submitting || pendingSubmit || pendingTest || pendingDisconnect);

	const status = $derived(connection?.status ?? 'disconnected');
	const connected = $derived(status === 'connected' && Boolean(connection?.credentials_configured));
	const statusLabel = $derived(
		status === 'connected'
			? 'Connected'
			: status === 'pending'
				? 'Pending'
				: status === 'error'
					? 'Error'
					: 'Disconnected'
	);

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
	class={cn(
		'bg-card space-y-4 rounded-2xl border border-border p-4 md:p-5',
		className
	)}
	data-testid="profile-caldav-form"
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
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="min-w-0 space-y-1">
			<p class="font-medium">CalDAV / Mailcow</p>
			<p class="text-muted-foreground text-sm" data-testid="caldav-connection-label">
				{connection ? calendarConnectionLabel(connection) : 'Not connected'}
			</p>
		</div>
		<span data-testid="caldav-connection-status">
			<StatusBadge status={statusLabel} />
		</span>
	</div>

	<p class="text-muted-foreground text-sm">
		Mailbox-shaped connect for Mailcow/SOGo (or any CalDAV URL). Use an app password when your host
		requires it — passwords are write-only and never shown after save.
	</p>

	{#if otherProviderActive && !connected}
		<p class="text-muted-foreground text-xs" data-testid="caldav-xor-note">
			Google is the active sync. Saving CalDAV disables Google push until you reconnect it.
		</p>
	{/if}

	{#if connection?.credentials_configured}
		<p class="text-muted-foreground text-xs" data-testid="caldav-credentials-saved">
			Password saved — leave blank to keep it, or enter a new one to replace.
		</p>
	{/if}

	{#if connectError}
		<p class="text-destructive text-sm" role="alert" data-testid="caldav-connect-error">
			{connectError}
		</p>
	{/if}

	{#if canEdit}
		<div class="grid gap-4 sm:grid-cols-2">
			<div class="space-y-2 sm:col-span-2">
				<Label for="caldav-url">CalDAV URL</Label>
				<Input
					id="caldav-url"
					name="caldavUrl"
					type="url"
					bind:value={$formData.caldavUrl}
					disabled={busy}
					placeholder="https://mail.example.com/SOGo/dav/user@example.com/Calendar/personal/"
					data-testid="caldav-url"
				/>
				{#if $errors.caldavUrl}
					<p class="text-destructive text-xs">{$errors.caldavUrl}</p>
				{/if}
			</div>
			<div class="space-y-2">
				<Label for="caldav-username">Username</Label>
				<Input
					id="caldav-username"
					name="username"
					bind:value={$formData.username}
					disabled={busy}
					placeholder="Usually your mailbox address"
					data-testid="caldav-username"
				/>
				{#if $errors.username}
					<p class="text-destructive text-xs">{$errors.username}</p>
				{/if}
			</div>
			<div class="space-y-2">
				<Label for="caldav-password">Password / app password</Label>
				<Input
					id="caldav-password"
					name="password"
					type="password"
					autocomplete="new-password"
					bind:value={$formData.password}
					disabled={busy}
					placeholder={connection?.credentials_configured ? '••••••••' : 'App password'}
					data-testid="caldav-password"
				/>
				<p class="text-muted-foreground text-xs">Write-only — never shown after save.</p>
				{#if $errors.password}
					<p class="text-destructive text-xs">{$errors.password}</p>
				{/if}
			</div>
			<div class="space-y-2 sm:col-span-2">
				<Label for="caldav-calendar-id">Calendar id (optional)</Label>
				<Input
					id="caldav-calendar-id"
					name="calendarId"
					bind:value={$formData.calendarId}
					disabled={busy}
					placeholder="Leave blank for default"
					data-testid="caldav-calendar-id"
				/>
				{#if $errors.calendarId}
					<p class="text-destructive text-xs">{$errors.calendarId}</p>
				{/if}
			</div>
		</div>

		{#if testFeedback}
			<p
				class={cn(
					'rounded-2xl px-3 py-2 text-xs',
					testFeedback.ok
						? 'bg-emerald-500/10 text-emerald-900 ring-1 ring-emerald-500/20 dark:text-emerald-100'
						: 'bg-destructive/10 text-destructive ring-1 ring-destructive/20'
				)}
				role="status"
				data-testid="caldav-test-feedback"
			>
				{testFeedback.message}
			</p>
		{/if}

		<div class="flex flex-wrap justify-end gap-2">
			{#if connection?.credentials_configured && onDisconnect}
				<Button
					type="button"
					variant="ghost"
					disabled={busy}
					onclick={handleDisconnect}
					data-testid="caldav-disconnect"
				>
					{pendingDisconnect ? 'Disconnecting…' : 'Disconnect'}
				</Button>
			{/if}
			{#if onTest}
				<Button
					type="button"
					variant="outline"
					disabled={busy || !connection?.credentials_configured}
					onclick={handleTest}
					data-testid="caldav-test"
				>
					{pendingTest ? 'Testing…' : 'Test connection'}
				</Button>
			{/if}
			<Button type="submit" disabled={busy} data-testid="caldav-submit">
				{pendingSubmit || $submitting ? 'Saving…' : submitLabel}
			</Button>
		</div>
	{:else}
		<p class="text-muted-foreground text-sm" data-testid="caldav-readonly-note">
			Ask an owner, admin, or member to connect CalDAV for push sync.
		</p>
	{/if}
</form>

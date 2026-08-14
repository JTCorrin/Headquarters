<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import {
		applyOrgInvoiceEmailPreset,
		orgInvoiceEmailPresets,
		orgInvoiceEmailSecurityOptions,
		type OrgInvoiceEmailAccountResource,
		type OrgInvoiceEmailFormData,
		type OrgInvoiceEmailPreset,
		type OrgInvoiceEmailTestFeedback
	} from '$lib/schemas/org-invoice-email.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { cn } from '$lib/utils.js';

	export interface OrgInvoiceEmailFormProps {
		form: SuperForm<OrgInvoiceEmailFormData>;
		account?: OrgInvoiceEmailAccountResource | null;
		canEdit: boolean;
		submitLabel?: string;
		class?: string;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
		onTest?: () =>
			| OrgInvoiceEmailTestFeedback
			| false
			| void
			| Promise<OrgInvoiceEmailTestFeedback | false | void>;
		onDisconnect?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		account = null,
		canEdit,
		submitLabel = 'Save',
		class: className,
		onValidSubmit,
		onTest,
		onDisconnect
	}: OrgInvoiceEmailFormProps = $props();

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);
	const enhance = untrack(() => form.enhance);
	const submitting = untrack(() => form.submitting);

	let pendingSubmit = $state(false);
	let pendingTest = $state(false);
	let pendingDisconnect = $state(false);
	let testFeedback = $state<OrgInvoiceEmailTestFeedback | null>(null);
	let submitLock = false;
	const busy = $derived($submitting || pendingSubmit || pendingTest || pendingDisconnect);
	const fieldsDisabled = $derived(busy || !canEdit);

	const presetLabels: Record<OrgInvoiceEmailPreset, string> = {
		gmail: 'Gmail',
		outlook: 'Outlook / Microsoft 365',
		custom: 'Custom'
	};

	const securityLabels: Record<(typeof orgInvoiceEmailSecurityOptions)[number], string> = {
		tls: 'SSL/TLS',
		starttls: 'STARTTLS',
		none: 'None'
	};

	const presetLabel = $derived(presetLabels[$formData.preset] ?? 'Preset');
	const smtpSecurityLabel = $derived(securityLabels[$formData.smtpSecurity] ?? 'Security');

	let lastAppliedPreset = $state<OrgInvoiceEmailPreset | null>(null);

	$effect(() => {
		const preset = $formData.preset;
		if (lastAppliedPreset === null) {
			lastAppliedPreset = preset;
			return;
		}
		if (preset === lastAppliedPreset) return;
		lastAppliedPreset = preset;
		formData.update((current) => applyOrgInvoiceEmailPreset(current, preset));
	});

	async function handleTest() {
		if (pendingTest || !onTest || !canEdit) return;
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
		if (pendingDisconnect || !onDisconnect || !canEdit) return;
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
	data-testid="org-invoice-email-form"
	use:enhance={{
		async onUpdate({ form: validated }) {
			if (!validated.valid) return;
			if (submitLock || !canEdit) return false;
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
	<input type="hidden" name="smtpSecurity" value={$formData.smtpSecurity} />

	{#if account?.credentials_configured}
		<p class="text-muted-foreground text-xs" data-testid="org-invoice-email-credentials-saved">
			Password saved — leave blank to keep it, or enter a new one to replace.
		</p>
	{/if}

	{#if account?.last_tested_at || account?.last_error_message || account?.last_error_code}
		<p class="text-muted-foreground text-xs" data-testid="org-invoice-email-status">
			{#if account.status}
				Status: {account.status}.
			{/if}
			{#if account.last_tested_at}
				Last tested {account.last_tested_at}.
			{/if}
			{#if account.last_error_message || account.last_error_code}
				<span class="text-destructive">
					{account.last_error_message ?? account.last_error_code}
				</span>
			{/if}
		</p>
	{/if}

	<div class="space-y-2">
		<Label for="org-invoice-email-preset">Provider preset</Label>
		<Select.Root type="single" bind:value={$formData.preset} disabled={fieldsDisabled}>
			<Select.Trigger
				id="org-invoice-email-preset"
				class="w-full"
				data-testid="org-invoice-email-preset-trigger"
				disabled={fieldsDisabled}
			>
				{presetLabel}
			</Select.Trigger>
			<Select.Content>
				{#each orgInvoiceEmailPresets as option (option)}
					<Select.Item value={option} label={presetLabels[option]}>{presetLabels[option]}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-2 sm:col-span-2">
			<Label for="org-invoice-email-from-address">From address</Label>
			<Input
				id="org-invoice-email-from-address"
				name="fromAddress"
				type="email"
				bind:value={$formData.fromAddress}
				disabled={fieldsDisabled}
				data-testid="org-invoice-email-from-address"
			/>
			{#if $errors.fromAddress}
				<p class="text-destructive text-xs">{$errors.fromAddress}</p>
			{/if}
		</div>
		<div class="space-y-2">
			<Label for="org-invoice-email-from-name">From name</Label>
			<Input
				id="org-invoice-email-from-name"
				name="fromName"
				bind:value={$formData.fromName}
				disabled={fieldsDisabled}
				data-testid="org-invoice-email-from-name"
			/>
			{#if $errors.fromName}
				<p class="text-destructive text-xs">{$errors.fromName}</p>
			{/if}
		</div>
		<div class="space-y-2">
			<Label for="org-invoice-email-reply-to">Reply-to</Label>
			<Input
				id="org-invoice-email-reply-to"
				name="replyTo"
				type="email"
				bind:value={$formData.replyTo}
				disabled={fieldsDisabled}
				data-testid="org-invoice-email-reply-to"
			/>
			{#if $errors.replyTo}
				<p class="text-destructive text-xs">{$errors.replyTo}</p>
			{/if}
		</div>
		<div class="space-y-2">
			<Label for="org-invoice-email-username">Username</Label>
			<Input
				id="org-invoice-email-username"
				name="username"
				bind:value={$formData.username}
				disabled={fieldsDisabled}
				placeholder="Usually the same as from address"
				data-testid="org-invoice-email-username"
			/>
			{#if $errors.username}
				<p class="text-destructive text-xs">{$errors.username}</p>
			{/if}
		</div>
		<div class="space-y-2">
			<Label for="org-invoice-email-password">Password / app password</Label>
			<Input
				id="org-invoice-email-password"
				name="password"
				type="password"
				autocomplete="new-password"
				bind:value={$formData.password}
				disabled={fieldsDisabled}
				placeholder={account?.credentials_configured ? '••••••••' : 'App password'}
				data-testid="org-invoice-email-password"
			/>
			<p class="text-muted-foreground text-xs">Write-only — never shown after save.</p>
			{#if $errors.password}
				<p class="text-destructive text-xs">{$errors.password}</p>
			{/if}
		</div>
	</div>

	<div class="grid gap-4 sm:grid-cols-3">
		<div class="space-y-2 sm:col-span-2">
			<Label for="org-invoice-email-smtp-host">SMTP host</Label>
			<Input
				id="org-invoice-email-smtp-host"
				name="smtpHost"
				bind:value={$formData.smtpHost}
				disabled={fieldsDisabled}
				data-testid="org-invoice-email-smtp-host"
			/>
			{#if $errors.smtpHost}
				<p class="text-destructive text-xs">{$errors.smtpHost}</p>
			{/if}
		</div>
		<div class="space-y-2">
			<Label for="org-invoice-email-smtp-port">SMTP port</Label>
			<Input
				id="org-invoice-email-smtp-port"
				name="smtpPort"
				bind:value={$formData.smtpPort}
				disabled={fieldsDisabled}
				data-testid="org-invoice-email-smtp-port"
			/>
			{#if $errors.smtpPort}
				<p class="text-destructive text-xs">{$errors.smtpPort}</p>
			{/if}
		</div>
		<div class="space-y-2 sm:col-span-3">
			<Label for="org-invoice-email-smtp-security">SMTP security</Label>
			<Select.Root type="single" bind:value={$formData.smtpSecurity} disabled={fieldsDisabled}>
				<Select.Trigger
					id="org-invoice-email-smtp-security"
					class="w-full"
					disabled={fieldsDisabled}
					data-testid="org-invoice-email-smtp-security-trigger"
				>
					{smtpSecurityLabel}
				</Select.Trigger>
				<Select.Content>
					{#each orgInvoiceEmailSecurityOptions as option (option)}
						<Select.Item value={option} label={securityLabels[option]}
							>{securityLabels[option]}</Select.Item
						>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	</div>

	<div class="space-y-2">
		<Label for="org-invoice-email-subject">Subject template</Label>
		<Input
			id="org-invoice-email-subject"
			name="subjectTemplate"
			bind:value={$formData.subjectTemplate}
			disabled={fieldsDisabled}
			data-testid="org-invoice-email-subject"
		/>
		{#if $errors.subjectTemplate}
			<p class="text-destructive text-xs">{$errors.subjectTemplate}</p>
		{/if}
	</div>

	<div class="space-y-2">
		<Label for="org-invoice-email-body">Body template</Label>
		<Textarea
			id="org-invoice-email-body"
			name="bodyTemplate"
			rows={6}
			bind:value={$formData.bodyTemplate}
			disabled={fieldsDisabled}
			data-testid="org-invoice-email-body"
		/>
		<p class="text-muted-foreground text-xs" data-testid="org-invoice-email-placeholders-hint">
			Placeholders: <code>{'{{invoice_number}}'}</code>, <code>{'{{client_name}}'}</code>,
			<code>{'{{total}}'}</code>, <code>{'{{due_on}}'}</code>, <code>{'{{org_name}}'}</code>
		</p>
		{#if $errors.bodyTemplate}
			<p class="text-destructive text-xs">{$errors.bodyTemplate}</p>
		{/if}
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
			data-testid="org-invoice-email-test-feedback"
		>
			{testFeedback.message}
		</p>
	{/if}

	{#if canEdit}
		<div class="flex flex-wrap justify-end gap-2">
			{#if account && onDisconnect}
				<Button
					type="button"
					variant="ghost"
					disabled={busy}
					onclick={handleDisconnect}
					data-testid="org-invoice-email-disconnect"
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
					data-testid="org-invoice-email-test"
				>
					{pendingTest ? 'Testing…' : 'Test connection'}
				</Button>
			{/if}
			<Button type="submit" disabled={busy} data-testid="org-invoice-email-submit">
				{pendingSubmit || $submitting ? 'Saving…' : submitLabel}
			</Button>
		</div>
	{/if}
</form>

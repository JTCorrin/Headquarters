<script lang="ts">
	import { resolve } from '$app/paths';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { MembershipRole } from '$lib/schemas/organisation.js';
	import { roleLabel } from '$lib/schemas/organisation.js';
	import {
		aiPromptHints,
		aiPromptKeys,
		aiPromptLabels,
		aiProviderLabels,
		aiProviders,
		canMutateIntegrations,
		DEFAULT_AI_PROMPTS,
		type AiIntegrationResource,
		type AiModelOption,
		type AiPromptKey,
		type AiProvider
	} from '$lib/schemas/integration.js';
	import type {
		OrgInvoiceEmailAccountResource,
		OrgInvoiceEmailFormData,
		OrgInvoiceEmailTestFeedback
	} from '$lib/schemas/org-invoice-email.js';
	import { type AppNavGroup } from './app-nav.svelte';
	import AppSidebarFrame from './app-sidebar-frame.svelte';
	import PageHeader from './page-header.svelte';
	import ResourceStateBanner, {
		type ResourceViewState
	} from './resource-state-banner.svelte';
	import StatusBadge from './status-badge.svelte';
	import AiProviderConnectDrawer from './ai-provider-connect-drawer.svelte';
	import OrgInvoiceEmailForm from './org-invoice-email-form.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { cn } from '$lib/utils.js';

	export type AiPromptsFormState = Record<AiPromptKey, string>;
	export type AiModelCatalogs = Partial<Record<AiProvider, AiModelOption[]>>;

	export interface OrgIntegrationsPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		role: MembershipRole;
		integrations?: AiIntegrationResource[];
		modelCatalogs?: AiModelCatalogs;
		modelsBusy?: AiProvider | null;
		modelError?: string | null;
		prompts?: AiPromptsFormState;
		promptDefaults?: AiPromptsFormState;
		promptsBusy?: boolean;
		promptsError?: string | null;
		invoiceEmailAccount?: OrgInvoiceEmailAccountResource | null;
		invoiceEmailForm?: SuperForm<OrgInvoiceEmailFormData> | null;
		viewState?: ResourceViewState;
		connectError?: string | null;
		class?: string;
		showNav?: boolean;
		onReload?: () => void;
		onConnect?: (provider: AiProvider, apiKey: string) => boolean | void | Promise<boolean | void>;
		onDisconnect?: (provider: AiProvider) => boolean | void | Promise<boolean | void>;
		onSelectModel?: (provider: AiProvider, model: string) => boolean | void | Promise<boolean | void>;
		onSavePrompts?: (prompts: AiPromptsFormState) => boolean | void | Promise<boolean | void>;
		onInvoiceEmailSubmit?: () => boolean | void | Promise<boolean | void>;
		onInvoiceEmailTest?: () =>
			| OrgInvoiceEmailTestFeedback
			| false
			| void
			| Promise<OrgInvoiceEmailTestFeedback | false | void>;
		onInvoiceEmailDisconnect?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		orgName,
		navGroups,
		role,
		integrations = [],
		modelCatalogs = {},
		modelsBusy = null,
		modelError = null,
		prompts = { ...DEFAULT_AI_PROMPTS },
		promptDefaults = { ...DEFAULT_AI_PROMPTS },
		promptsBusy = false,
		promptsError = null,
		invoiceEmailAccount = null,
		invoiceEmailForm = null,
		viewState = { kind: 'ready' },
		connectError = null,
		class: className,
		showNav = true,
		onReload,
		onConnect,
		onDisconnect,
		onSelectModel,
		onSavePrompts,
		onInvoiceEmailSubmit,
		onInvoiceEmailTest,
		onInvoiceEmailDisconnect
	}: OrgIntegrationsPageProps = $props();

	const canEdit = $derived(canMutateIntegrations(role));
	const showContent = $derived(
		viewState.kind === 'ready' || viewState.kind === 'empty' || viewState.kind === 'conflict'
	);

	let drawerOpen = $state(false);
	let activeProvider = $state<AiProvider | null>(null);
	let disconnectBusy = $state<AiProvider | null>(null);
	let draftPrompts = $state<AiPromptsFormState>({ ...DEFAULT_AI_PROMPTS });

	$effect(() => {
		draftPrompts = { ...prompts };
	});

	function statusFor(provider: AiProvider): AiIntegrationResource {
		return (
			integrations.find((item) => item.provider === provider) ?? {
				provider,
				credentials_configured: false,
				status: 'disconnected',
				selected_model: null,
				last_verified_at: null,
				last_error_code: null
			}
		);
	}

	async function handleSelectModel(provider: AiProvider, event: Event) {
		const value = (event.currentTarget as HTMLSelectElement).value;
		if (!value || !canEdit) return;
		await onSelectModel?.(provider, value);
	}

	function openConnect(provider: AiProvider) {
		activeProvider = provider;
		drawerOpen = true;
	}

	async function handleConnect(apiKey: string): Promise<boolean> {
		if (!activeProvider) return false;
		const result = await onConnect?.(activeProvider, apiKey);
		return result === false ? false : true;
	}

	async function handleDisconnect(provider: AiProvider) {
		if (!canEdit || disconnectBusy) return;
		disconnectBusy = provider;
		try {
			await onDisconnect?.(provider);
		} finally {
			disconnectBusy = null;
		}
	}

	function resetPrompt(key: AiPromptKey) {
		draftPrompts = { ...draftPrompts, [key]: promptDefaults[key] };
	}

	async function handleSavePrompts() {
		if (!canEdit || promptsBusy) return;
		await onSavePrompts?.({ ...draftPrompts });
	}
</script>

<AppSidebarFrame
	{orgName}
	groups={navGroups}
	{showNav}
	showTrigger={showNav}
	class={cn(
		showNav ? 'h-full min-h-svh' : 'min-h-0 flex-1 flex-col',
		className
	)}
>

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-8 px-4 py-6 sm:px-6 md:px-8">
			<PageHeader
				breadcrumb="Organisation · Settings"
				title="Integrations"
				description="Connect organisation AI providers for Draft response. Personal IMAP/SMTP lives under Config → Mail."
			>
				{#snippet actions()}
					<span class="text-muted-foreground text-xs">Your role: {roleLabel(role)}</span>
				{/snippet}
			</PageHeader>

			<ResourceStateBanner state={viewState} {onReload} />

			{#if showContent}
				<section class="space-y-4" data-testid="ai-integrations-section">
					<div>
						<h2 class="text-lg font-semibold tracking-tight">AI providers</h2>
						<p class="text-muted-foreground text-sm">
							API-key connect for OpenAI, Anthropic, Google, and OpenRouter. No fake OAuth buttons —
							Draft response stays in the email reply composer.
							{#if !canEdit}
								Read-only for your role.
							{/if}
						</p>
					</div>

					<ul class="divide-border divide-y rounded-3xl border" data-testid="ai-integrations-list">
						{#each aiProviders as provider (provider)}
							{@const item = statusFor(provider)}
							{@const catalog = modelCatalogs[provider] ?? []}
							<li class="space-y-3 px-4 py-3" data-testid={`ai-integration-row-${provider}`}>
								<div class="flex flex-wrap items-center justify-between gap-3">
									<div class="min-w-0 space-y-1">
										<div class="flex flex-wrap items-center gap-2">
											<p class="truncate font-medium">{aiProviderLabels[provider]}</p>
											{#if item.credentials_configured && item.status === 'connected'}
												<StatusBadge status="Connected" />
											{:else if item.status === 'error'}
												<StatusBadge status="Error" />
											{:else}
												<StatusBadge status="Not connected" />
											{/if}
										</div>
										<p class="text-muted-foreground text-sm">
											{#if item.credentials_configured}
												Key saved{item.last_verified_at ? ` · verified ${item.last_verified_at}` : ''}.
												{#if item.selected_model}
													· model <span class="text-foreground">{item.selected_model}</span>
												{/if}
											{:else}
												Paste an API key to enable Draft response for the org.
											{/if}
											{#if item.last_error_code}
												<span class="text-destructive"> {item.last_error_code}</span>
											{/if}
										</p>
									</div>
									{#if canEdit}
										<div class="flex flex-wrap gap-2">
											{#if item.credentials_configured}
												<Button
													type="button"
													size="sm"
													variant="outline"
													data-testid={`ai-integration-reconnect-${provider}`}
													onclick={() => openConnect(provider)}
												>
													Replace key
												</Button>
												<Button
													type="button"
													size="sm"
													variant="ghost"
													disabled={disconnectBusy === provider}
													data-testid={`ai-integration-disconnect-${provider}`}
													onclick={() => handleDisconnect(provider)}
												>
													{disconnectBusy === provider ? 'Disconnecting…' : 'Disconnect'}
												</Button>
											{:else}
												<Button
													type="button"
													size="sm"
													data-testid={`ai-integration-connect-${provider}`}
													onclick={() => openConnect(provider)}
												>
													Connect
												</Button>
											{/if}
										</div>
									{/if}
								</div>

								{#if item.credentials_configured && item.status === 'connected'}
									<div class="max-w-xl space-y-1.5" data-testid={`ai-model-picker-${provider}`}>
										<Label for={`ai-model-${provider}`}>Model</Label>
										<select
											id={`ai-model-${provider}`}
											class="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
											disabled={!canEdit || modelsBusy === provider || catalog.length === 0}
											value={item.selected_model ?? ''}
											onchange={(event) => void handleSelectModel(provider, event)}
											data-testid={`ai-model-select-${provider}`}
										>
											<option value="" disabled>
												{modelsBusy === provider
													? 'Loading models…'
													: catalog.length === 0
														? 'No models available'
														: 'Select a model'}
											</option>
											{#each catalog as model (model.id)}
												<option value={model.id}>{model.label}</option>
											{/each}
										</select>
										<p class="text-muted-foreground text-xs">
											Used for Draft response, Generate summary, and Draft chase when this
											provider is active.
										</p>
									</div>
								{/if}
							</li>
						{/each}
					</ul>
					{#if modelError}
						<p class="text-destructive text-sm" role="alert" data-testid="ai-model-error">
							{modelError}
						</p>
					{/if}
				</section>

				<section class="space-y-4" data-testid="ai-prompts-section">
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div>
							<h2 class="text-lg font-semibold tracking-tight">AI prompts</h2>
							<p class="text-muted-foreground text-sm">
								Defaults ship with the product. Edit to tune Draft response, meeting summary, and
								chase assists for this organisation.
								{#if !canEdit}
									Read-only for your role.
								{/if}
							</p>
						</div>
						{#if canEdit}
							<Button
								type="button"
								size="sm"
								disabled={promptsBusy}
								data-testid="ai-prompts-save"
								onclick={() => void handleSavePrompts()}
							>
								{promptsBusy ? 'Saving…' : 'Save prompts'}
							</Button>
						{/if}
					</div>

					{#if promptsError}
						<p class="text-destructive text-sm" role="alert" data-testid="ai-prompts-error">
							{promptsError}
						</p>
					{/if}

					<div class="space-y-5 rounded-3xl border p-4" data-testid="ai-prompts-form">
						{#each aiPromptKeys as key (key)}
							<div class="space-y-2" data-testid={`ai-prompt-field-${key}`}>
								<div class="flex flex-wrap items-center justify-between gap-2">
									<Label for={`ai-prompt-${key}`}>{aiPromptLabels[key]}</Label>
									{#if canEdit}
										<Button
											type="button"
											size="sm"
											variant="ghost"
											data-testid={`ai-prompt-reset-${key}`}
											onclick={() => resetPrompt(key)}
										>
											Reset to default
										</Button>
									{/if}
								</div>
								<p class="text-muted-foreground text-xs">{aiPromptHints[key]}</p>
								<Textarea
									id={`ai-prompt-${key}`}
									rows={4}
									disabled={!canEdit || promptsBusy}
									bind:value={draftPrompts[key]}
									data-testid={`ai-prompt-textarea-${key}`}
								/>
							</div>
						{/each}
					</div>
				</section>

				<section class="space-y-4" data-testid="org-invoice-email-section">
					<div>
						<h2 class="text-lg font-semibold tracking-tight">Invoice email</h2>
						<p class="text-muted-foreground text-sm">
							Organisation SMTP used for recurring invoice auto-send. Your personal mailbox stays
							under
							<a class="underline underline-offset-2" href="{resolve('/settings')}#mail"
								>My settings → Mail</a
							>.
							{#if !canEdit}
								Read-only for your role.
							{/if}
						</p>
					</div>

					{#if canEdit && invoiceEmailForm}
						<OrgInvoiceEmailForm
							form={invoiceEmailForm}
							account={invoiceEmailAccount}
							{canEdit}
							onValidSubmit={onInvoiceEmailSubmit}
							onTest={onInvoiceEmailTest}
							onDisconnect={onInvoiceEmailDisconnect}
						/>
					{:else if invoiceEmailAccount}
						<div
							class="space-y-1 rounded-3xl border px-4 py-3"
							data-testid="org-invoice-email-readonly"
						>
							<p class="font-medium">{invoiceEmailAccount.from_address}</p>
							<p class="text-muted-foreground text-sm">
								Status: {invoiceEmailAccount.status}
								{#if invoiceEmailAccount.credentials_configured}
									· credentials configured
								{/if}
								{#if invoiceEmailAccount.last_tested_at}
									· last tested {invoiceEmailAccount.last_tested_at}
								{/if}
							</p>
							{#if invoiceEmailAccount.last_error_message || invoiceEmailAccount.last_error_code}
								<p class="text-destructive text-sm">
									{invoiceEmailAccount.last_error_message ??
										invoiceEmailAccount.last_error_code}
								</p>
							{/if}
						</div>
					{:else}
						<p class="text-muted-foreground text-sm" data-testid="org-invoice-email-not-configured">
							Not configured
						</p>
					{/if}
				</section>
			{/if}
		</div>
	</main>
</AppSidebarFrame>

{#if canEdit}
	<AiProviderConnectDrawer
		provider={activeProvider}
		bind:open={drawerOpen}
		{connectError}
		onConnect={handleConnect}
	/>
{/if}

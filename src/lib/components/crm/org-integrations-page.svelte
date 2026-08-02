<script lang="ts">
	import type { MembershipRole } from '$lib/schemas/organisation.js';
	import { roleLabel } from '$lib/schemas/organisation.js';
	import {
		aiProviderLabels,
		aiProviders,
		canMutateIntegrations,
		type AiIntegrationResource,
		type AiProvider
	} from '$lib/schemas/integration.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import ResourceStateBanner, {
		type ResourceViewState
	} from './resource-state-banner.svelte';
	import StatusBadge from './status-badge.svelte';
	import AiProviderConnectDrawer from './ai-provider-connect-drawer.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface OrgIntegrationsPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		role: MembershipRole;
		integrations?: AiIntegrationResource[];
		viewState?: ResourceViewState;
		connectError?: string | null;
		class?: string;
		showNav?: boolean;
		onReload?: () => void;
		onConnect?: (provider: AiProvider, apiKey: string) => boolean | void | Promise<boolean | void>;
		onDisconnect?: (provider: AiProvider) => boolean | void | Promise<boolean | void>;
	}

	let {
		orgName,
		navGroups,
		role,
		integrations = [],
		viewState = { kind: 'ready' },
		connectError = null,
		class: className,
		showNav = true,
		onReload,
		onConnect,
		onDisconnect
	}: OrgIntegrationsPageProps = $props();

	const canEdit = $derived(canMutateIntegrations(role));
	const showContent = $derived(
		viewState.kind === 'ready' || viewState.kind === 'empty' || viewState.kind === 'conflict'
	);

	let drawerOpen = $state(false);
	let activeProvider = $state<AiProvider | null>(null);
	let disconnectBusy = $state<AiProvider | null>(null);

	function statusFor(provider: AiProvider): AiIntegrationResource {
		return (
			integrations.find((item) => item.provider === provider) ?? {
				provider,
				credentials_configured: false,
				status: 'disconnected',
				last_verified_at: null,
				last_error_code: null
			}
		);
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
</script>

<div
	class={cn(
		'bg-background text-foreground flex',
		showNav ? 'h-full min-h-svh' : 'min-h-0 flex-1 flex-col',
		className
	)}
>
	{#if showNav}
		<AppNav {orgName} groups={navGroups} class="h-full shrink-0 self-stretch" />
	{/if}

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-8 px-6 py-6 md:px-8">
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
							<li
								class="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
								data-testid={`ai-integration-row-${provider}`}
							>
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
							</li>
						{/each}
					</ul>
				</section>

				<section class="space-y-2" data-testid="email-sending-plane-note">
					<h2 class="text-lg font-semibold tracking-tight">Email sending</h2>
					<p class="text-muted-foreground text-sm">
						Organisation quote / invoice / campaign SMTP is a separate plane and lands later.
						Personal mailbox IMAP/SMTP is under <a class="underline underline-offset-2" href="/org/config#mail">Config → Mail</a>.
					</p>
				</section>
			{/if}
		</div>
	</main>
</div>

{#if canEdit}
	<AiProviderConnectDrawer
		provider={activeProvider}
		bind:open={drawerOpen}
		{connectError}
		onConnect={handleConnect}
	/>
{/if}

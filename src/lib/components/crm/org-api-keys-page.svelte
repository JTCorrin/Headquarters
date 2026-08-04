<script lang="ts">
	import type { ApiOrgApiKey } from '$lib/api/v1/types.js';
	import type { ApiKeyCreateData } from '$lib/schemas/api-key.js';
	import { apiKeyRoleLabel } from '$lib/schemas/api-key.js';
	import type { MembershipRole } from '$lib/schemas/organisation.js';
	import { roleLabel } from '$lib/schemas/organisation.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import ResourceStateBanner, {
		type ResourceViewState
	} from './resource-state-banner.svelte';
	import StatusBadge from './status-badge.svelte';
	import OrgApiKeysCreateDrawer from './org-api-keys-create-drawer.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface OrgApiKeysPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		role: MembershipRole;
		keys?: ApiOrgApiKey[];
		viewState?: ResourceViewState;
		createError?: string | null;
		revealedSecret?: string | null;
		class?: string;
		showNav?: boolean;
		onReload?: () => void;
		onCreate?: (input: ApiKeyCreateData) => boolean | void | Promise<boolean | void>;
		onRevoke?: (id: string) => boolean | void | Promise<boolean | void>;
		onDismissSecret?: () => void;
	}

	let {
		orgName,
		navGroups,
		role,
		keys = [],
		viewState = { kind: 'ready' },
		createError = null,
		revealedSecret = null,
		class: className,
		showNav = true,
		onReload,
		onCreate,
		onRevoke,
		onDismissSecret
	}: OrgApiKeysPageProps = $props();

	const showContent = $derived(
		viewState.kind === 'ready' || viewState.kind === 'empty' || viewState.kind === 'conflict'
	);

	let drawerOpen = $state(false);
	let revokeBusy = $state<string | null>(null);

	function formatWhen(iso: string | null): string {
		if (!iso) return 'Never';
		try {
			return new Date(iso).toLocaleString(undefined, {
				dateStyle: 'medium',
				timeStyle: 'short'
			});
		} catch {
			return iso;
		}
	}

	async function handleRevoke(key: ApiOrgApiKey) {
		if (revokeBusy) return;
		const ok = window.confirm(
			`Revoke “${key.name}”? Agents using this key will lose access immediately.`
		);
		if (!ok) return;
		revokeBusy = key.id;
		try {
			await onRevoke?.(key.id);
		} finally {
			revokeBusy = null;
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
				title="API keys"
				description="Org-scoped keys for agents and scripts. Secrets are shown once at create — paste into your agent host config."
			>
				{#snippet actions()}
					<div class="flex flex-wrap items-center gap-3">
						<span class="text-muted-foreground text-xs">Your role: {roleLabel(role)}</span>
						<Button
							type="button"
							size="sm"
							data-testid="org-api-keys-create"
							onclick={() => {
								drawerOpen = true;
							}}
						>
							Create key
						</Button>
					</div>
				{/snippet}
			</PageHeader>

			<ResourceStateBanner state={viewState} {onReload} />

			{#if showContent}
				<section class="space-y-4" data-testid="org-api-keys-section">
					{#if keys.length === 0}
						<p class="text-muted-foreground text-sm" data-testid="org-api-keys-empty">
							No active API keys yet. Create one to connect an agent host to Headquarters.
						</p>
					{:else}
						<ul class="divide-border divide-y rounded-3xl border" data-testid="org-api-keys-list">
							{#each keys as key (key.id)}
								<li
									class="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
									data-testid={`org-api-keys-row-${key.id}`}
								>
									<div class="min-w-0 space-y-1">
										<div class="flex flex-wrap items-center gap-2">
											<p class="truncate font-medium">{key.name}</p>
											<StatusBadge status="Active" />
											<span
												class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs"
												>{apiKeyRoleLabel(key.role)}</span
											>
										</div>
										<p class="text-muted-foreground font-mono text-sm">{key.prefix}…</p>
										<p class="text-muted-foreground text-xs">
											Created {formatWhen(key.created_at)} · Last used {formatWhen(
												key.last_used_at
											)}
										</p>
									</div>
									<Button
										type="button"
										size="sm"
										variant="ghost"
										disabled={revokeBusy === key.id}
										data-testid={`org-api-keys-revoke-${key.id}`}
										onclick={() => handleRevoke(key)}
									>
										{revokeBusy === key.id ? 'Revoking…' : 'Revoke'}
									</Button>
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			{/if}
		</div>
	</main>
</div>

<OrgApiKeysCreateDrawer
	actorRole={role}
	bind:open={drawerOpen}
	{createError}
	{revealedSecret}
	{onCreate}
	{onDismissSecret}
/>

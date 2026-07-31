<script lang="ts">
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import StatusBadge from './status-badge.svelte';
	import {
		roleLabel,
		type OrgMembershipSummary
	} from '$lib/schemas/organisation.js';
	import { cn } from '$lib/utils.js';

	export interface OrgSwitcherProps {
		currentOrgId: string;
		memberships: OrgMembershipSummary[];
		switchError?: string | null;
		busy?: boolean;
		class?: string;
		onSwitchOrg?: (orgId: string) => void;
		onCreateOrg?: () => void;
	}

	let {
		currentOrgId,
		memberships,
		switchError = null,
		busy = false,
		class: className,
		onSwitchOrg,
		onCreateOrg
	}: OrgSwitcherProps = $props();

	const current = $derived(
		memberships.find((m) => m.org_id === currentOrgId) ?? memberships[0] ?? null
	);

	function initials(name: string): string {
		const parts = name.trim().split(/\s+/).filter(Boolean);
		if (parts.length === 0) return '?';
		if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
		return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
	}
</script>

<div class={cn('space-y-2', className)} data-testid="org-switcher">
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					type="button"
					variant="outline"
					size="sm"
					class="max-w-full justify-start gap-2"
					disabled={busy}
					data-testid="org-switcher-trigger"
					aria-label="Organisation switcher"
				>
					{#if current?.logo_url}
						<img
							src={current.logo_url}
							alt=""
							class="size-6 shrink-0 rounded-md object-cover"
						/>
					{:else}
						<span
							class="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold"
							aria-hidden="true"
						>
							{initials(current?.org_name ?? 'Org')}
						</span>
					{/if}
					<span class="truncate font-medium">{current?.org_name ?? 'Select organisation'}</span>
					{#if current}
						<span class="text-muted-foreground hidden shrink-0 sm:inline">
							<StatusBadge status={roleLabel(current.role)} />
						</span>
					{/if}
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="start" class="w-72" data-testid="org-switcher-menu">
			<DropdownMenu.Label>Organisations</DropdownMenu.Label>
			<DropdownMenu.Separator />
			{#if memberships.length === 0}
				<div class="text-muted-foreground px-2 py-3 text-sm">No organisations yet.</div>
			{:else}
				{#each memberships as membership (membership.org_id)}
					<DropdownMenu.Item
						class="gap-2"
						disabled={busy || membership.org_id === currentOrgId}
						onclick={() => onSwitchOrg?.(membership.org_id)}
						data-testid={`org-switch-${membership.org_id}`}
					>
						{#if membership.logo_url}
							<img
								src={membership.logo_url}
								alt=""
								class="size-6 shrink-0 rounded-md object-cover"
							/>
						{:else}
							<span
								class="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold"
								aria-hidden="true"
							>
								{initials(membership.org_name)}
							</span>
						{/if}
						<span class="min-w-0 flex-1 truncate">{membership.org_name}</span>
						<StatusBadge status={roleLabel(membership.role)} class="shrink-0" />
					</DropdownMenu.Item>
				{/each}
			{/if}
			<DropdownMenu.Separator />
			<DropdownMenu.Item
				disabled={busy}
				onclick={() => onCreateOrg?.()}
				data-testid="org-switcher-create"
			>
				Create organisation
			</DropdownMenu.Item>
		</DropdownMenu.Content>
	</DropdownMenu.Root>

	{#if switchError}
		<p class="text-destructive text-xs" role="alert" data-testid="org-switcher-error">
			{switchError}
		</p>
	{/if}
</div>

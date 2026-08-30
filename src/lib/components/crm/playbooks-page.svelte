<script lang="ts">
	import { goto } from '$app/navigation';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError, userMessage } from '$lib/api/v1/errors.js';
	import {
		membershipFromCreateResult,
		roleFromMemberships,
		toOrganisationCreateBody
	} from '$lib/api/v1/mappers.js';
	import type { ApiPlaybook } from '$lib/api/v1/types.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import AppShell from './app-shell.svelte';
	import PageHeader from './page-header.svelte';
	import ResourceStateBanner, {
		type ResourceViewState
	} from './resource-state-banner.svelte';

	export interface PlaybooksPageProps {
		api: ApiV1Client;
		session: OrgSession;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onLogout?: () => void | Promise<void>;
		class?: string;
	}

	let {
		api,
		session,
		onMissingOrg,
		onSwitchNavigate,
		onLogout,
		class: className
	}: PlaybooksPageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let rows = $state<ApiPlaybook[]>([]);
	let createName = $state('');
	let listError = $state<string | null>(null);
	let createError = $state<string | null>(null);
	let switchError = $state<string | null>(null);
	let busy = $state(false);

	const orgName = $derived(
		session.memberships.find((m) => m.org_id === session.selectedOrgId)?.org_name ??
			'Organisation'
	);
	const role = $derived(
		(roleFromMemberships(session.memberships, session.selectedOrgId) ??
			'member') as MembershipRole
	);
	const navGroups = $derived(appNavGroups('Playbooks', role));
	const currentOrgId = $derived(session.selectedOrgId ?? '');


	interface RequestEpoch {
		orgId: string | null;
		generation: number;
	}

	const liveEpoch: RequestEpoch = {
		orgId: null,
		generation: 0
	};

	function epochMatches(epoch: RequestEpoch): boolean {
		return epoch.orgId === liveEpoch.orgId && epoch.generation === liveEpoch.generation;
	}

	async function loadPlaybooks() {
		const orgId = session.selectedOrgId;
		if (!orgId) {
			viewState = { kind: 'empty', message: 'Select an organisation to manage playbooks.' };
			rows = [];
			onMissingOrg?.();
			return;
		}
		const epoch: RequestEpoch = {
			orgId,
			generation: ++liveEpoch.generation
		};
		liveEpoch.orgId = orgId;
		viewState = { kind: 'loading' };
		listError = null;
		try {
			const result = await api.playbooks.list({ limit: 100 });
			if (!epochMatches(epoch)) return;
			rows = result.data;
			viewState =
				rows.length === 0
					? {
							kind: 'empty',
							message: 'No playbooks yet. Create one to start automating Comms workflows.'
						}
					: { kind: 'ready' };
		} catch (error) {
			if (!epochMatches(epoch)) return;
			listError = userMessage(error, 'Failed to load playbooks.');
			viewState = { kind: 'validation', message: listError };
		}
	}

	async function createPlaybook() {
		const name = createName.trim();
		if (!name) {
			createError = 'Name is required';
			return;
		}
		busy = true;
		createError = null;
		try {
			const created = await api.playbooks.create({ name });
			createName = '';
			void goto(`/playbooks/${created.id}`);
		} catch (error) {
			createError = userMessage(error, 'Failed to create playbook.');
		} finally {
			busy = false;
		}
	}

	function onSwitchOrg(orgId: string) {
		switchError = null;
		busy = true;
		session.selectOrg(orgId);
		onSwitchNavigate?.(orgId);
		busy = false;
	}

	async function onValidCreate(data: OrganisationCreateData): Promise<boolean> {
		createError = null;
		try {
			const result = await api.organisations.create(toOrganisationCreateBody(data));
			const membership = membershipFromCreateResult(result);
			session.setMemberships([...session.memberships, membership]);
			session.selectOrg(membership.org_id);
			onSwitchNavigate?.(membership.org_id);
			return true;
		} catch (error) {
			createError = userMessage(error, 'Could not create organisation — try again.');
			return false;
		}
	}

	$effect(() => {
		void currentOrgId;
		void session.cacheGeneration;
		void loadPlaybooks();
	});
</script>

{#if currentOrgId}
	<div class={className} data-testid="playbooks-page">
		<AppShell
			{currentOrgId}
			memberships={session.memberships}
			{orgName}
			{navGroups}
			{switchError}
			{busy}
			{createError}
			{onSwitchOrg}
			{onLogout}
			{onValidCreate}
		>
			<div class="space-y-6 px-4 py-6 sm:px-6 md:px-8">
				{#if viewState.kind === 'empty' || viewState.kind === 'validation'}
					<ResourceStateBanner state={viewState} onReload={() => void loadPlaybooks()} />
				{/if}

				<PageHeader
					breadcrumb="Comms"
					title="Playbooks"
					description="Automations triggered by email, invoices, payments, and schedules."
				/>

				<form
					class="flex max-w-xl flex-col gap-2 sm:flex-row sm:items-end"
					onsubmit={(e) => {
						e.preventDefault();
						void createPlaybook();
					}}
				>
					<div class="min-w-0 flex-1 space-y-1">
						<label class="text-muted-foreground text-xs font-medium" for="playbook-name"
							>New playbook</label
						>
						<Input
							id="playbook-name"
							bind:value={createName}
							placeholder="e.g. Overdue invoice chase"
							disabled={busy}
						/>
					</div>
					<Button type="submit" size="sm" disabled={busy}>Create</Button>
				</form>

				{#if viewState.kind === 'loading'}
					<p class="text-muted-foreground text-sm">Loading playbooks…</p>
				{:else if rows.length > 0}
					<ul class="divide-border border-border divide-y rounded-lg border">
						{#each rows as row (row.id)}
							<li>
								<a
									href={`/playbooks/${row.id}`}
									class="hover:bg-muted/50 flex items-center justify-between gap-4 px-4 py-3 transition-colors"
								>
									<div class="min-w-0">
										<p class="truncate text-sm font-medium">{row.name}</p>
										{#if row.description}
											<p class="text-muted-foreground truncate text-xs">{row.description}</p>
										{/if}
									</div>
									<span
										class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium {row.is_active
											? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
											: 'bg-muted text-muted-foreground'}"
									>
										{row.is_active ? 'Active' : 'Inactive'}
									</span>
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="playbooks-page">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before opening playbooks.
		</p>
	</div>
{/if}

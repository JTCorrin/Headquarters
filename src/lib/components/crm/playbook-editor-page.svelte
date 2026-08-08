<script lang="ts">
	import { goto } from '$app/navigation';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import {
		membershipFromCreateResult,
		roleFromMemberships,
		toOrganisationCreateBody
	} from '$lib/api/v1/mappers.js';
	import type { ApiPlaybook } from '$lib/api/v1/types.js';
	import {
		createDefaultPlaybookGraph,
		validatePlaybookGraph
	} from '$lib/playbook/playbook-graph.js';
	import { appNavGroups } from '$lib/org/nav.js';
	import type { OrgSession } from '$lib/org/session.svelte.js';
	import type { MembershipRole, OrganisationCreateData } from '$lib/schemas/organisation.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import AppShell from './app-shell.svelte';
	import PageHeader from './page-header.svelte';
	import ResourceStateBanner, {
		type ResourceViewState
	} from './resource-state-banner.svelte';

	export interface PlaybookEditorPageProps {
		api: ApiV1Client;
		session: OrgSession;
		playbookId: string;
		onMissingOrg?: () => void;
		onSwitchNavigate?: (orgId: string) => void;
		onLogout?: () => void | Promise<void>;
		class?: string;
	}

	let {
		api,
		session,
		playbookId,
		onMissingOrg,
		onSwitchNavigate,
		onLogout,
		class: className
	}: PlaybookEditorPageProps = $props();

	let viewState = $state<ResourceViewState>({ kind: 'loading' });
	let playbook = $state<ApiPlaybook | null>(null);
	let name = $state('');
	let description = $state('');
	let isActive = $state(false);
	let graphText = $state('');
	let saveError = $state<string | null>(null);
	let saveOk = $state<string | null>(null);
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

	function userMessage(error: unknown, fallback: string): string {
		if (isApiClientError(error)) {
			if (error.isNetworkError) return 'Network error — check your connection and retry.';
			if (error.isForbidden) return error.message || 'You do not have permission for this action.';
			if (error.isValidationError) {
				if (error.fields) return Object.values(error.fields).join(' · ') || error.message;
				return error.message;
			}
			return error.message || fallback;
		}
		return fallback;
	}

	async function load() {
		if (!session.selectedOrgId) {
			viewState = { kind: 'empty', message: 'Select an organisation to edit playbooks.' };
			onMissingOrg?.();
			return;
		}
		viewState = { kind: 'loading' };
		saveError = null;
		saveOk = null;
		try {
			const result = await api.playbooks.get(playbookId);
			playbook = result.data;
			name = playbook.name;
			description = playbook.description ?? '';
			isActive = playbook.is_active;
			graphText = JSON.stringify(playbook.graph_json, null, 2);
			viewState = { kind: 'ready' };
		} catch (error) {
			if (isApiClientError(error) && error.status === 404) {
				viewState = { kind: 'not_found', message: 'Playbook not found.' };
			} else {
				viewState = {
					kind: 'validation',
					message: userMessage(error, 'Failed to load playbook.')
				};
			}
		}
	}

	async function save() {
		if (!playbook) return;
		busy = true;
		saveError = null;
		saveOk = null;
		let parsed: unknown;
		try {
			parsed = JSON.parse(graphText);
		} catch {
			saveError = 'graph_json must be valid JSON';
			busy = false;
			return;
		}
		const validated = validatePlaybookGraph(parsed);
		if (!validated.ok) {
			saveError = validated.errors.join(' ');
			busy = false;
			return;
		}
		try {
			const updated = await api.playbooks.update(
				playbook.id,
				{
					name: name.trim(),
					description: description.trim() || null,
					is_active: isActive,
					graph_json: validated.graph as unknown as Record<string, unknown>
				},
				playbook.version
			);
			playbook = updated;
			graphText = JSON.stringify(updated.graph_json, null, 2);
			saveOk = 'Saved';
		} catch (error) {
			saveError = userMessage(error, 'Failed to save playbook.');
		} finally {
			busy = false;
		}
	}

	async function remove() {
		if (!playbook) return;
		if (!confirm(`Delete playbook “${playbook.name}”?`)) return;
		busy = true;
		saveError = null;
		try {
			await api.playbooks.delete(playbook.id, playbook.version);
			void goto('/playbooks');
		} catch (error) {
			saveError = userMessage(error, 'Failed to delete playbook.');
			busy = false;
		}
	}

	function resetGraph() {
		graphText = JSON.stringify(createDefaultPlaybookGraph(), null, 2);
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
		void playbookId;
		void session.cacheGeneration;
		void load();
	});
</script>

{#if currentOrgId}
	<div class={className} data-testid="playbook-editor-page">
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
			<div class="space-y-6 px-6 py-6 md:px-8">
				{#if viewState.kind !== 'ready'}
					<ResourceStateBanner state={viewState} onReload={() => void load()} />
				{:else if playbook}
					<PageHeader
						breadcrumb="Comms / Playbooks"
						title={playbook.name}
						description="Phase A editor: persist name, active flag, and validated graph JSON. Visual canvas lands in Phase B."
					>
						{#snippet actions()}
							<Button type="button" variant="outline" size="sm" href="/playbooks">Back</Button>
							<Button type="button" size="sm" disabled={busy} onclick={() => void save()}
								>Save</Button
							>
						{/snippet}
					</PageHeader>

					<div class="grid max-w-3xl gap-4">
						<div class="space-y-1">
							<Label for="pb-name">Name</Label>
							<Input id="pb-name" bind:value={name} disabled={busy} />
						</div>
						<div class="space-y-1">
							<Label for="pb-desc">Description</Label>
							<Input id="pb-desc" bind:value={description} disabled={busy} />
						</div>
						<label class="flex items-center gap-2 text-sm">
							<input type="checkbox" bind:checked={isActive} disabled={busy} />
							Active (eligible for triggers once runner ships)
						</label>
						<div class="space-y-1">
							<div class="flex items-center justify-between gap-2">
								<Label for="pb-graph">Graph JSON</Label>
								<Button type="button" variant="ghost" size="sm" onclick={resetGraph}
									>Reset to default trigger</Button
								>
							</div>
							<textarea
								id="pb-graph"
								class="border-input bg-background focus-visible:ring-ring min-h-[320px] w-full rounded-md border px-3 py-2 font-mono text-xs focus-visible:ring-2 focus-visible:outline-none"
								bind:value={graphText}
								disabled={busy}
								spellcheck="false"
							></textarea>
						</div>
						{#if saveError}
							<p class="text-destructive text-sm">{saveError}</p>
						{/if}
						{#if saveOk}
							<p class="text-muted-foreground text-sm">{saveOk}</p>
						{/if}
						<div>
							<Button
								type="button"
								variant="destructive"
								size="sm"
								disabled={busy}
								onclick={() => void remove()}>Delete playbook</Button
							>
						</div>
					</div>
				{/if}
			</div>
		</AppShell>
	</div>
{:else}
	<div class="p-6" data-testid="playbook-editor-page">
		<p class="text-destructive text-sm" role="alert">
			Select an organisation before editing playbooks.
		</p>
	</div>
{/if}

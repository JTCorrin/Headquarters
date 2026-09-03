<script lang="ts">
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError, userMessage } from '$lib/api/v1/errors.js';
	import type { ApiEntityTag, ApiTag } from '$lib/api/v1/types.js';
	import type { TagEntityType } from '$lib/api/v1/endpoints/types.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { cn } from '$lib/utils.js';
	import { SvelteSet } from 'svelte/reactivity';

	export interface EntityTagsEditorProps {
		api: ApiV1Client;
		entityType: TagEntityType;
		entityId: string;
		canEdit?: boolean;
		class?: string;
	}

	let {
		api,
		entityType,
		entityId,
		canEdit = false,
		class: className
	}: EntityTagsEditorProps = $props();

	let open = $state(false);
	let loading = $state(true);
	let saving = $state(false);
	let error = $state<string | null>(null);
	let orgTags = $state<ApiTag[]>([]);
	let entityTags = $state<ApiEntityTag[]>([]);
	let newTagName = $state('');
	let creatingTag = $state(false);

	const selectedIds = $derived(new SvelteSet(entityTags.map((tag) => tag.id)));

	$effect(() => {
		const id = entityId;
		const type = entityType;
		void loadTags(id, type);
	});

	async function loadTags(id: string, type: TagEntityType) {
		loading = true;
		error = null;
		try {
			const [listed, assigned] = await Promise.all([
				api.tags.list({ limit: 200 }),
				api.tags.listForEntity(type, id)
			]);
			orgTags = listed.data;
			entityTags = assigned.data;
		} catch (err) {
			error = userMessage(err, 'Could not load tags.');
		} finally {
			loading = false;
		}
	}

	async function persistSelection(nextIds: string[]) {
		saving = true;
		error = null;
		try {
			entityTags = await api.tags.replaceForEntity(entityType, entityId, nextIds);
		} catch (err) {
			error = userMessage(err, 'Could not update tags.');
			await loadTags(entityId, entityType);
		} finally {
			saving = false;
		}
	}

	async function toggleTag(tagId: string) {
		if (!canEdit || saving) return;
		const next = new SvelteSet(selectedIds);
		if (next.has(tagId)) next.delete(tagId);
		else next.add(tagId);
		await persistSelection([...next]);
	}

	async function createAndAssignTag() {
		const name = newTagName.trim();
		if (!name || !canEdit || creatingTag) return;
		creatingTag = true;
		error = null;
		try {
			const created = await api.tags.create({ name });
			orgTags = [...orgTags, created].sort((a, b) => a.name.localeCompare(b.name));
			newTagName = '';
			const nextIds = [...selectedIds, created.id];
			await persistSelection(nextIds);
			open = false;
		} catch (err) {
			error =
				isApiClientError(err) && (err.status === 409 || err.code === 'CONFLICT')
					? 'A tag with this name already exists.'
					: userMessage(err, 'Could not create tag.');
		} finally {
			creatingTag = false;
		}
	}

	function tagStyle(color: string | null | undefined): string | undefined {
		if (!color) return undefined;
		return `background-color: ${color}20; border-color: ${color}; color: ${color}`;
	}
</script>

<div class={cn('flex flex-wrap items-center gap-2', className)} data-testid="entity-tags-editor">
	<span class="text-muted-foreground text-xs font-medium uppercase tracking-wide">Tags</span>
	{#if loading}
		<span class="text-muted-foreground text-sm">Loading tags…</span>
	{:else if error && entityTags.length === 0}
		<span class="text-destructive text-sm" role="alert">{error}</span>
	{:else}
		{#each entityTags as tag (tag.id)}
			<Badge variant="outline" class="font-normal" style={tagStyle(tag.color)}>
				{tag.name}
			</Badge>
		{/each}
		{#if entityTags.length === 0 && !canEdit}
			<span class="text-muted-foreground text-sm">No tags</span>
		{/if}
	{/if}

	{#if canEdit}
		<Popover.Root bind:open>
			<Popover.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						type="button"
						variant="outline"
						size="sm"
						class="h-7 px-2"
						disabled={loading || saving}
						data-testid="entity-tags-edit"
					>
						Edit
					</Button>
				{/snippet}
			</Popover.Trigger>
			<Popover.Content class="w-72 p-3" align="start">
				<div class="space-y-3">
					<p class="text-sm font-medium">Tags</p>
					<div class="max-h-48 space-y-1 overflow-y-auto">
						{#each orgTags as tag (tag.id)}
							<label
								class="hover:bg-muted flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm"
							>
								<input
									type="checkbox"
									class="size-4 rounded border"
									checked={selectedIds.has(tag.id)}
									disabled={saving}
									onchange={() => void toggleTag(tag.id)}
								/>
								<span>{tag.name}</span>
							</label>
						{:else}
							<p class="text-muted-foreground px-2 py-1 text-sm">No org tags yet.</p>
						{/each}
					</div>
					<form
						class="flex gap-2"
						onsubmit={(event) => {
							event.preventDefault();
							void createAndAssignTag();
						}}
					>
						<Input
							bind:value={newTagName}
							placeholder="New tag name"
							maxlength={80}
							disabled={creatingTag || saving}
							class="h-8"
						/>
						<Button type="submit" size="sm" disabled={!newTagName.trim() || creatingTag}>
							Add
						</Button>
					</form>
					{#if error}
						<p class="text-destructive text-xs" role="alert">{error}</p>
					{/if}
				</div>
			</Popover.Content>
		</Popover.Root>
	{/if}
</div>

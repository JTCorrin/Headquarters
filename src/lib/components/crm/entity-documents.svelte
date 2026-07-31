<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { DocumentFormData } from '$lib/schemas/document.js';
	import DocumentFormDrawer from './document-form-drawer.svelte';
	import StatusBadge from './status-badge.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import FileTextIcon from '@lucide/svelte/icons/file-text';

	export interface EntityDocument {
		id: string;
		name: string;
		category: string;
		sizeLabel?: string;
		uploadedAt: string;
		uploadedBy?: string;
	}

	export interface EntityDocumentsProps {
		documents?: EntityDocument[];
		form: SuperForm<DocumentFormData>;
		drawerOpen?: boolean;
		emptyMessage?: string;
		class?: string;
	}

	let {
		documents = [],
		form,
		drawerOpen = $bindable(false),
		emptyMessage = 'No documents attached yet.',
		class: className
	}: EntityDocumentsProps = $props();
</script>

<section
	class={cn(
		'bg-card overflow-hidden rounded-3xl ring-1 ring-foreground/5 dark:ring-foreground/10',
		className
	)}
>
	<div class="flex items-center justify-between gap-3 px-4 py-3">
		<div>
			<p class="text-sm font-semibold tracking-tight">Documents</p>
			<p class="text-muted-foreground text-xs">{documents.length} attached</p>
		</div>
		<DocumentFormDrawer bind:open={drawerOpen} {form}>
			{#snippet trigger()}
				<Button type="button" size="sm">
					<PlusIcon class="size-3.5" />
					Attach
				</Button>
			{/snippet}
		</DocumentFormDrawer>
	</div>

	{#if documents.length === 0}
		<p class="text-muted-foreground border-t px-4 py-8 text-center text-sm">{emptyMessage}</p>
	{:else}
		<ul class="m-0 list-none border-t p-0">
			{#each documents as doc (doc.id)}
				<li
					class="hover:bg-muted/40 flex items-start gap-3 border-t px-4 py-3 first:border-t-0"
				>
					<div
						class="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-xl"
					>
						<FileTextIcon class="size-4" />
					</div>
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-medium">{doc.name}</p>
						<p class="text-muted-foreground mt-0.5 text-xs">
							{doc.uploadedAt}{#if doc.uploadedBy}
								· {doc.uploadedBy}{/if}{#if doc.sizeLabel}
								· {doc.sizeLabel}{/if}
						</p>
					</div>
					<StatusBadge status={doc.category} />
				</li>
			{/each}
		</ul>
	{/if}
</section>

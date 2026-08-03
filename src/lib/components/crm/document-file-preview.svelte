<script lang="ts">
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import type { DocumentPreviewState } from '$lib/api/v1/document-workspace-controller.svelte.js';
	import DownloadIcon from '@lucide/svelte/icons/download';

	export interface DocumentFilePreviewProps {
		preview: DocumentPreviewState | null;
		class?: string;
		onClose?: () => void;
		onDownload?: () => void;
	}

	let {
		preview,
		class: className,
		onClose,
		onDownload
	}: DocumentFilePreviewProps = $props();

	const isPdf = $derived(
		(preview?.mimeType.toLowerCase().split(';')[0]?.trim() ?? '') === 'application/pdf'
	);
	const isImage = $derived(
		(preview?.mimeType.toLowerCase().split(';')[0]?.trim() ?? '').startsWith('image/')
	);
</script>

<Sheet.Root
	open={preview != null}
	onOpenChange={(next) => {
		if (!next) onClose?.();
	}}
>
	<Sheet.Content
		side="bottom"
		class={cn(
			'mx-auto flex h-[min(90vh,48rem)] w-full max-w-4xl flex-col gap-0 p-0',
			className
		)}
		data-testid="documents-preview-sheet"
	>
		{#if preview}
			<Sheet.Header
				class="shrink-0 border-b px-4 py-3 text-left sm:flex-row sm:items-center sm:justify-between"
			>
				<div class="min-w-0">
					<Sheet.Title class="truncate">{preview.name}</Sheet.Title>
					<Sheet.Description class="truncate">{preview.mimeType}</Sheet.Description>
				</div>
				{#if onDownload}
					<Button
						type="button"
						variant="outline"
						size="sm"
						class="mt-2 shrink-0 sm:mt-0"
						data-testid="documents-preview-download"
						onclick={onDownload}
					>
						<DownloadIcon class="size-3.5" />
						Download
					</Button>
				{/if}
			</Sheet.Header>
			<div
				class="bg-muted/30 flex min-h-0 flex-1 items-center justify-center overflow-auto p-3"
				data-testid="documents-preview-body"
			>
				{#if isImage}
					<img
						src={preview.url}
						alt={preview.name}
						class="max-h-full max-w-full object-contain"
						data-testid="documents-preview-image"
					/>
				{:else if isPdf}
					<iframe
						title={preview.name}
						src={preview.url}
						class="h-full min-h-[24rem] w-full rounded-md bg-background"
						data-testid="documents-preview-pdf"
					></iframe>
				{:else}
					<p class="text-muted-foreground text-sm">Preview is not available for this file type.</p>
				{/if}
			</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>

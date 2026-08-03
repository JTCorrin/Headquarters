<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import {
		formatBillSourceAttachmentSize,
		type BillSourceAttachmentMeta
	} from '$lib/crm/bill-source-attachment.js';
	import DocumentFilePreview from './document-file-preview.svelte';
	import type { DocumentPreviewState } from '$lib/api/v1/document-workspace-controller.svelte.js';
	import FileUpIcon from '@lucide/svelte/icons/file-up';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';

	export interface BillSourceAttachmentProps {
		attachment: BillSourceAttachmentMeta | null;
		canEdit?: boolean;
		pending?: boolean;
		errorMessage?: string | null;
		preview?: DocumentPreviewState | null;
		class?: string;
		onUpload?: (file: File) => void | Promise<void>;
		onClear?: () => void | Promise<void>;
		onPreview?: () => void | Promise<void>;
		onClosePreview?: () => void;
		onDownloadPreview?: () => void;
	}

	let {
		attachment,
		canEdit = true,
		pending = false,
		errorMessage = null,
		preview = null,
		class: className,
		onUpload,
		onClear,
		onPreview,
		onClosePreview,
		onDownloadPreview
	}: BillSourceAttachmentProps = $props();

	let fileInput: HTMLInputElement | undefined = $state();

	function onFileChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (file) void onUpload?.(file);
	}
</script>

<section
	class={cn(
		'bg-card space-y-3 rounded-3xl p-5 ring-1 ring-foreground/5 dark:ring-foreground/10',
		className
	)}
	data-testid="bill-source-attachment"
>
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0">
			<h2 class="text-sm font-semibold tracking-tight">Source document</h2>
			<p class="text-muted-foreground text-xs">
				Vendor PDF or image linked to this bill.
			</p>
		</div>
		{#if canEdit && !attachment}
			<input
				bind:this={fileInput}
				type="file"
				accept="application/pdf,image/*"
				class="sr-only"
				data-testid="bill-source-file-input"
				onchange={onFileChange}
			/>
			<Button
				type="button"
				size="sm"
				variant="outline"
				disabled={pending}
				data-testid="bill-source-upload"
				onclick={() => fileInput?.click()}
			>
				{#if pending}
					<LoaderCircleIcon class="size-3.5 animate-spin" />
					Uploading…
				{:else}
					<FileUpIcon class="size-3.5" />
					Upload
				{/if}
			</Button>
		{/if}
	</div>

	{#if errorMessage}
		<p class="text-destructive text-xs" role="alert" data-testid="bill-source-error">
			{errorMessage}
		</p>
	{/if}

	{#if attachment}
		<div
			class="bg-muted/40 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-3 py-2.5"
			data-testid="bill-source-meta"
		>
			<div class="min-w-0">
				<p class="truncate text-sm font-medium" data-testid="bill-source-name">
					{attachment.name}
				</p>
				<p class="text-muted-foreground text-xs" data-testid="bill-source-size">
					{formatBillSourceAttachmentSize(attachment.sizeBytes)}
					{#if attachment.mimeType}
						· {attachment.mimeType}
					{/if}
				</p>
			</div>
			<div class="flex shrink-0 flex-wrap gap-2">
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={pending}
					data-testid="bill-source-preview"
					onclick={() => onPreview?.()}
				>
					<EyeIcon class="size-3.5" />
					Preview
				</Button>
				{#if canEdit}
					<input
						bind:this={fileInput}
						type="file"
						accept="application/pdf,image/*"
						class="sr-only"
						data-testid="bill-source-file-input"
						onchange={onFileChange}
					/>
					<Button
						type="button"
						size="sm"
						variant="outline"
						disabled={pending}
						data-testid="bill-source-replace"
						onclick={() => fileInput?.click()}
					>
						Replace
					</Button>
					<Button
						type="button"
						size="sm"
						variant="ghost"
						disabled={pending}
						data-testid="bill-source-clear"
						onclick={() => onClear?.()}
					>
						<Trash2Icon class="size-3.5" />
						Clear
					</Button>
				{/if}
			</div>
		</div>
	{:else if !canEdit}
		<p class="text-muted-foreground text-sm" data-testid="bill-source-empty">
			No source document attached.
		</p>
	{:else}
		<p class="text-muted-foreground text-sm" data-testid="bill-source-empty">
			Upload the vendor invoice or receipt PDF/image.
		</p>
	{/if}
</section>

<DocumentFilePreview
	{preview}
	onClose={onClosePreview}
	onDownload={onDownloadPreview}
/>

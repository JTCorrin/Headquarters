<script lang="ts">
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import {
		createDocumentWorkspaceController,
		type DocumentWorkspaceController
	} from '$lib/api/v1/document-workspace-controller.svelte.js';
	import type { ApiDocumentCategory, ApiDocumentEntityType } from '$lib/api/v1/types.js';
	import EntityDocuments from './entity-documents.svelte';

	interface Props {
		client: ApiV1Client;
		entityType: ApiDocumentEntityType;
		entityId: string;
		title?: string;
		emptyMessage?: string;
		defaultCategory?: ApiDocumentCategory;
		class?: string;
	}

	let {
		client,
		entityType,
		entityId,
		title = 'Documents',
		emptyMessage,
		defaultCategory = 'other',
		class: className
	}: Props = $props();

	let controller = $state.raw<DocumentWorkspaceController | null>(null);

	$effect(() => {
		const next = createDocumentWorkspaceController({
			client,
			entityType,
			entityId,
			defaultCategory
		});
		controller = next;
		return () => {
			if (controller === next) controller = null;
		};
	});
</script>

{#if controller}
	<EntityDocuments
		class={className}
		{title}
		{emptyMessage}
		view={controller.view}
		viewMode={controller.viewMode}
		uploads={controller.uploads}
		moveTargets={controller.moveTargets}
		onNavigate={(folderId) => {
			void controller?.navigate(folderId);
		}}
		onViewModeChange={(mode) => controller?.setViewMode(mode)}
		onUpload={(files) => controller?.uploadFiles(files)}
		onRetryUpload={(id) => controller?.retryUpload(id)}
		onCancelUpload={(id) => controller?.cancelUpload(id)}
		onCreateFolder={(name) => {
			void controller?.createFolder(name);
		}}
		onRename={(id, name) => {
			void controller?.rename(id, name);
		}}
		onMove={(id, target) => {
			void controller?.move(id, target);
		}}
		onDelete={(id) => {
			void controller?.remove(id);
		}}
		onRestore={(id) => {
			void controller?.restore(id);
		}}
		onDownload={(id) => {
			void controller?.download(id);
		}}
		onPreview={(id) => {
			void controller?.preview(id);
		}}
		onRetryView={() => {
			void controller?.refresh();
		}}
	/>
{/if}

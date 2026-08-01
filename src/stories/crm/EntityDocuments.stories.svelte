<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import EntityDocuments from '$lib/components/crm/entity-documents.svelte';
	import EntityDocumentsStoryHost from '$lib/components/crm/entity-documents.story-host.svelte';

	const { Story } = defineMeta({
		title: 'Headquarters/EntityDocuments',
		component: EntityDocuments,
		tags: ['autodocs']
	});
</script>

<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { documentFormSchema } from '$lib/schemas/document.js';
	import type { DocumentEntry, EntityDocument } from '$lib/components/crm/entity-documents.svelte';
	import {
		sampleBillDocuments,
		sampleClientWorkspaceDocuments,
		sampleContractDocuments,
		sampleDocuments
	} from './story-fixtures.js';

	let documents = $state<EntityDocument[]>([...sampleDocuments]);
	let drawerOpen = $state(false);

	const documentData = defaults(
		{ name: '', category: 'contract', notes: '' },
		zod4(documentFormSchema)
	);

	const form = superForm(documentData, {
		validators: zod4(documentFormSchema),
		SPA: true,
		warnings: { duplicateId: false },
		resetForm: true,
		onUpdate({ form: f }) {
			if (!f.valid) return;
			const d = f.data;
			documents = [
				{
					id: crypto.randomUUID(),
					name: d.name,
					category: d.category,
					sizeLabel: '—',
					uploadedAt: 'Just now',
					uploadedBy: 'You'
				},
				...documents
			];
			drawerOpen = false;
		}
	});

	const workspaceSeed: DocumentEntry[] = [
		{
			id: 'folder-contracts',
			kind: 'folder',
			name: 'Contracts',
			itemCount: 2,
			updatedAt: 'Mar 1'
		},
		{
			id: 'folder-bills',
			kind: 'folder',
			name: 'Bills',
			itemCount: 1,
			updatedAt: 'Apr 4'
		},
		...sampleDocuments.map((doc) => ({
			id: doc.id,
			kind: 'file' as const,
			name: doc.name,
			category: doc.category,
			sizeLabel: doc.sizeLabel,
			uploadedAt: doc.uploadedAt,
			uploadedBy: doc.uploadedBy
		}))
	];
</script>

<Story name="Default">
	{#snippet template()}
		<div class="mx-auto max-w-xl p-6">
			<EntityDocuments {documents} {form} bind:drawerOpen />
		</div>
	{/snippet}
</Story>

<Story name="Workspace">
	{#snippet template()}
		<div class="mx-auto max-w-3xl p-6">
			<EntityDocumentsStoryHost
				title="Documents"
				initialEntries={workspaceSeed}
				class="min-h-[28rem]"
			/>
		</div>
	{/snippet}
</Story>

<Story name="ClientWorkspace">
	{#snippet template()}
		<div class="mx-auto max-w-3xl p-6">
			<EntityDocumentsStoryHost
				title="Northwind · Documents"
				initialEntries={sampleClientWorkspaceDocuments}
				class="min-h-[28rem]"
			/>
		</div>
	{/snippet}
</Story>

<Story name="Contracts">
	{#snippet template()}
		<div class="mx-auto max-w-3xl p-6">
			<EntityDocumentsStoryHost
				title="Contracts"
				initialEntries={sampleContractDocuments}
				class="min-h-[24rem]"
			/>
		</div>
	{/snippet}
</Story>

<Story name="Bills">
	{#snippet template()}
		<div class="mx-auto max-w-3xl p-6">
			<EntityDocumentsStoryHost
				title="Bills & payables"
				initialEntries={sampleBillDocuments}
				class="min-h-[24rem]"
			/>
		</div>
	{/snippet}
</Story>

<Story name="Loading">
	{#snippet template()}
		<div class="mx-auto max-w-xl p-6">
			<EntityDocumentsStoryHost initialView="loading" initialEntries={[]} />
		</div>
	{/snippet}
</Story>

<Story name="Error">
	{#snippet template()}
		<div class="mx-auto max-w-xl p-6">
			<EntityDocumentsStoryHost
				initialView="error"
				errorMessage="Signed URL expired — reload the workspace."
				initialEntries={[]}
			/>
		</div>
	{/snippet}
</Story>

<Story name="UploadFailures">
	{#snippet template()}
		<div class="mx-auto max-w-3xl p-6">
			<EntityDocumentsStoryHost
				title="Upload retry"
				failUploads={true}
				initialEntries={workspaceSeed.slice(0, 2)}
				class="min-h-[24rem]"
			/>
		</div>
	{/snippet}
</Story>

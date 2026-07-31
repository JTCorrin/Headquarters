<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import EntityDocuments from '$lib/components/crm/entity-documents.svelte';

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
	import type { EntityDocument } from '$lib/components/crm/entity-documents.svelte';
	import { sampleDocuments } from './story-fixtures.js';

	let documents = $state<EntityDocument[]>([...sampleDocuments]);
	let drawerOpen = $state(false);

	const documentData = defaults(
		{ name: '', category: 'contract', notes: '' },
		zod4(documentFormSchema)
	);

	const form = superForm(documentData, {
		validators: zod4(documentFormSchema),
		SPA: true,
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
</script>

<Story name="Default">
	{#snippet template()}
		<div class="mx-auto max-w-xl p-6">
			<EntityDocuments {documents} {form} bind:drawerOpen />
		</div>
	{/snippet}
</Story>

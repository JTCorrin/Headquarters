<script lang="ts">
	import type {
		DocumentContactOption,
		DocumentRecipientFormRow
	} from '$lib/schemas/document-recipients.js';
	import DocumentRecipientsField from './document-recipients-field.svelte';

	let {
		clientId = '',
		contactOptions = [] as DocumentContactOption[],
		recipients = [] as DocumentRecipientFormRow[]
	}: {
		clientId?: string;
		contactOptions?: DocumentContactOption[];
		recipients?: DocumentRecipientFormRow[];
	} = $props();
</script>

<DocumentRecipientsField
	{clientId}
	{contactOptions}
	{recipients}
	onRecipientsChange={(next) => {
		recipients = next;
	}}
/>

<script lang="ts">
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		emptyMailboxFormData,
		mailboxFormSchema,
		type MailboxAccountResource,
		type MailboxTestFeedback
	} from '$lib/schemas/mailbox.js';
	import ProfileMailboxForm from './profile-mailbox-form.svelte';

	export interface ProfileMailboxFormTestHostProps {
		account?: MailboxAccountResource | null;
		preset?: 'gmail' | 'outlook' | 'custom';
		oauthError?: string | null;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
		onConnectOAuth?: (provider: 'microsoft' | 'google') => boolean | void | Promise<boolean | void>;
		onTest?: () => MailboxTestFeedback | false | void | Promise<MailboxTestFeedback | false | void>;
		onSync?: () => MailboxTestFeedback | false | void | Promise<MailboxTestFeedback | false | void>;
		onSaveSyncInterval?: (
			minutes: number
		) => MailboxTestFeedback | false | void | Promise<MailboxTestFeedback | false | void>;
		onDisconnect?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		account = null,
		preset = 'gmail',
		oauthError = null,
		onValidSubmit,
		onConnectOAuth,
		onTest,
		onSync,
		onSaveSyncInterval,
		onDisconnect
	}: ProfileMailboxFormTestHostProps = $props();

	// svelte-ignore state_referenced_locally -- superForm options are fixed at init; preset never changes in tests
	const initialPreset = $state.snapshot({ preset }).preset;
	const form = superForm(defaults(emptyMailboxFormData(initialPreset), zod4(mailboxFormSchema)), {
		validators: zod4(mailboxFormSchema),
		SPA: true,
		warnings: { duplicateId: false },
		applyAction: false,
		resetForm: false
	});
</script>

<ProfileMailboxForm
	{form}
	{account}
	{oauthError}
	{onValidSubmit}
	{onConnectOAuth}
	{onTest}
	{onSync}
	{onSaveSyncInterval}
	{onDisconnect}
/>

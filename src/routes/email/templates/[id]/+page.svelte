<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getApiV1Client } from '$lib/api/v1/index.js';
	import { getAuthSession } from '$lib/auth/index.js';
	import { logoutAndRedirect } from '$lib/auth/logout.js';
	import { getOrgSession } from '$lib/org/index.js';
	import EmailTemplatePage from '$lib/components/crm/email-template-page.svelte';

	const api = getApiV1Client();
	const session = getOrgSession();
	const auth = getAuthSession();
	const templateId = $derived(page.params.id ?? '');

	async function handleLogout() {
		await logoutAndRedirect(auth, session);
	}
</script>

{#if templateId}
	<EmailTemplatePage
		{api}
		{session}
		{templateId}
		onMissingOrg={() => {
			void goto('/select-org');
		}}
		onSwitchNavigate={() => {
			void goto('/email/templates');
		}}
		onSaved={(id) => {
			if (templateId === 'new') {
				void goto(`/email/templates/${id}`);
			}
		}}
		onBack={() => {
			void goto('/email/templates');
		}}
		onDeleted={() => {
			void goto('/email/templates');
		}}
		onLogout={handleLogout}
	/>
{/if}

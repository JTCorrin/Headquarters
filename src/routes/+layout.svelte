<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import AuthSessionLayout from '$lib/components/crm/auth-session-layout.svelte';
	import './layout.css';

	let { children, data } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{#key data.user?.id}
	<AuthSessionLayout initialSession={data.session} userId={data.user?.id}>
		{@render children()}
	</AuthSessionLayout>
{/key}

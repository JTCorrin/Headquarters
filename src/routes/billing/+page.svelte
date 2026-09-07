<script lang="ts">
	import { resolve } from '$app/paths';
	import { env } from '$env/dynamic/public';
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button/index.js';
	let { data, form } = $props();
	const pricing =
		(env.PUBLIC_LANDING_URL || 'https://headquarters-crm.com').replace(/\/$/, '') + '/#pricing';
</script>

<svelte:head
	><title>Hosted subscription — Headquarters</title><meta
		name="referrer"
		content="no-referrer"
	/></svelte:head
>
<div class="mx-auto max-w-xl space-y-6 px-6 py-12">
	<h1 class="text-3xl font-semibold">Your hosted subscription</h1>
	{#if form?.error}<p role="alert" class="text-destructive">{form.error}</p>{/if}
	{#if data.entitlement}
		<p>Your subscription is {data.entitlement.status}. Your organisation includes three seats.</p>
		<Button href={resolve('/')}>Continue to Headquarters</Button>
	{:else}
		<p>
			Link your payment to continue. If you have already paid, recover that payment below instead of
			purchasing again.
		</p>
	{/if}
	{#if data.claim}
		<form method="POST" action="?/claim" use:enhance class="space-y-3">
			<input type="hidden" name="token" value={data.claim} />
			<Button type="submit">Link this payment</Button>
		</form>
	{/if}
	{#if data.entitlement && !data.entitlement.org_id && data.ownedOrganisations.length}
		<form method="POST" action="?/attach" use:enhance class="space-y-3">
			<label for="billing-org">Use this subscription for an existing organisation</label>
			<select id="billing-org" name="org_id" class="w-full rounded-md border p-2">
				{#each data.ownedOrganisations as org (org.id)}<option value={org.id}>{org.name}</option
					>{/each}
			</select><Button type="submit">Attach subscription</Button>
		</form>
	{/if}

	<form method="POST" action="?/recover" use:enhance class="space-y-3">
		<label for="checkout-reference" class="block font-medium">Recover an existing payment</label>
		<p class="text-sm text-muted-foreground">
			Use the checkout reference beginning cs_ from the address you returned to after paying. Sign
			in with the same email you used at checkout.
		</p>
		<input
			id="checkout-reference"
			name="session_id"
			value={data.sessionId}
			required
			autocomplete="off"
			class="w-full rounded-md border p-2"
		/>
		<Button type="submit" variant="outline">Recover payment</Button>
	</form>
	{#each data.billingAccounts as account (account.id)}
		<form method="POST" action="?/portal">
			<p class="font-medium">{account.name} — {account.status}</p>
			<input type="hidden" name="subscription_id" value={account.id} />
			<Button type="submit" variant="outline">Manage subscription</Button>
			<p class="mt-2 text-sm text-muted-foreground">
				Update your card, view subscription invoices, or cancel through Stripe.
			</p>
		</form>
	{/each}
	<p class="text-sm">
		Have not purchased a plan? <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external marketing origin -->
		<a href={pricing} class="underline">View hosted pricing</a>.
	</p>
	<a href={resolve('/login')} class="text-sm underline">Back to sign in</a>
</div>

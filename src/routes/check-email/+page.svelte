<script lang="ts">
	import { page } from '$app/state';
	import { safeNextPath } from '$lib/auth/index.js';
	import PageHeader from '$lib/components/crm/page-header.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';

	const email = $derived(page.url.searchParams.get('email')?.trim() ?? '');
	const next = $derived(safeNextPath(page.url.searchParams.get('next')));
	const nextQuery = $derived(next === '/' ? '' : `?next=${encodeURIComponent(next)}`);
</script>

<div class="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center gap-6 p-6">
	<PageHeader
		title="Check your email"
		description="Confirm your address to finish creating your account."
	/>
	<Card.Root>
		<Card.Header>
			<Card.Title>Confirmation link sent</Card.Title>
			<Card.Description>
				We sent a confirmation link{email ? ` to ${email}` : ''}. Open it in this browser to
				continue.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-3">
			<p class="text-sm text-muted-foreground">
				The link may take a few minutes to arrive. Check your spam folder if you do not see it.
			</p>
			<Button href={`/login${nextQuery}`} variant="outline" class="w-full">Back to sign in</Button>
		</Card.Content>
	</Card.Root>
</div>

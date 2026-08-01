<script lang="ts">
	import { goto } from '$app/navigation';
	import PageHeader from '$lib/components/crm/page-header.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
</script>

<div class="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center gap-6 p-6">
	<PageHeader title="Connect integrations" description="Coming soon — skip for this MVP." />
	<Card.Root>
		<Card.Content class="space-y-4 pt-6">
			<p class="text-muted-foreground text-sm">
				Integrations are out of scope for the email/password onboarding wave.
			</p>
			<Button
				type="button"
				onclick={() => {
					void goto('/onboarding/create-org');
				}}
				data-testid="onboarding-connect-skip"
			>
				Back to create organisation
			</Button>
		</Card.Content>
	</Card.Root>
</div>

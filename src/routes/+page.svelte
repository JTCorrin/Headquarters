<script lang="ts">
	import { goto } from '$app/navigation';
	import { getAuthSession, postAuthDestination } from '$lib/auth/index.js';
	import { getOrgSession } from '$lib/org/index.js';

	const auth = getAuthSession();
	const orgSession = getOrgSession();

	$effect(() => {
		if (!auth.ready) return;
		if (!auth.enabled) {
			if (orgSession.selectedOrgId) {
				void goto('/org/config');
			} else {
				void goto('/select-org');
			}
			return;
		}
		if (!auth.session) {
			void goto('/login');
			return;
		}
		void goto(
			postAuthDestination({
				membershipCount: orgSession.memberships.length,
				selectedOrgId: orgSession.selectedOrgId
			})
		);
	});
</script>

<p class="text-muted-foreground p-6 text-sm">Redirecting…</p>

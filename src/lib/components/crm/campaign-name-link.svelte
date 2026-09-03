<script lang="ts">
	import { resolve } from '$app/paths';

	export interface CampaignNameLinkProps {
		id: string;
		name: string;
	}

	let { id, name }: CampaignNameLinkProps = $props();

	const href = $derived(resolve(`/campaigns/${id}`));
</script>

<a {href} class="font-medium hover:underline">{name}</a>

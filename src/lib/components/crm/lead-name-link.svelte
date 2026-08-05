<script lang="ts">
	export interface LeadNameLinkProps {
		id: string;
		name: string;
	}

	let { id, name }: LeadNameLinkProps = $props();
</script>

<a href="/leads/{id}" class="hover:underline" data-testid="lead-name-link">{name}</a>

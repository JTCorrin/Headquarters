<script lang="ts">
	export interface ContactNameLinkProps {
		id: string;
		name: string;
	}

	let { id, name }: ContactNameLinkProps = $props();
</script>

<a href="/contacts/{id}" class="hover:underline">{name}</a>

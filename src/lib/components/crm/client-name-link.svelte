<script lang="ts">
	export interface ClientNameLinkProps {
		id: string;
		name: string;
	}

	let { id, name }: ClientNameLinkProps = $props();
</script>

<a href="/clients/{id}" class="hover:underline">{name}</a>

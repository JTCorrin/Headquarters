<script lang="ts">
	export interface BillNumberLinkProps {
		id: string;
		number: string;
	}

	let { id, number }: BillNumberLinkProps = $props();
</script>

<a href="/bills/{id}" class="hover:underline">{number}</a>

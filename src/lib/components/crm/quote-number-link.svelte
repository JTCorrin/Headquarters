<script lang="ts">
	export interface QuoteNumberLinkProps {
		id: string;
		number: string;
	}

	let { id, number }: QuoteNumberLinkProps = $props();
</script>

<a href="/quotes/{id}" class="hover:underline">{number}</a>

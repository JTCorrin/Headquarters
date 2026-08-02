<script lang="ts">
	export interface ProductSkuLinkProps {
		id: string;
		sku: string;
	}

	let { id, sku }: ProductSkuLinkProps = $props();
</script>

<a href="/products/{id}" class="hover:underline">{sku}</a>

<script lang="ts">
	export interface InvoiceNumberLinkProps {
		id: string;
		number: string;
	}

	let { id, number }: InvoiceNumberLinkProps = $props();
</script>

<a href="/invoices/{id}" class="hover:underline">{number}</a>

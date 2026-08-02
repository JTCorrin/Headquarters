<script lang="ts">
	export interface RecurringInvoiceNameLinkProps {
		id: string;
		name: string;
	}

	let { id, name }: RecurringInvoiceNameLinkProps = $props();
</script>

<a href="/recurring-invoices/{id}" class="hover:underline">{name}</a>

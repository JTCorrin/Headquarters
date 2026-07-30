<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import StatusBadge from './status-badge.svelte';
	import { cn } from '$lib/utils.js';

	export interface ContactRow {
		id: string;
		name: string;
		email: string;
		company?: string;
		status: string;
		owner?: string;
	}

	export interface ContactsTableProps {
		rows: ContactRow[];
		class?: string;
	}

	let { rows, class: className }: ContactsTableProps = $props();
</script>

<div class={cn('overflow-hidden rounded-3xl ring-1 ring-foreground/5 dark:ring-foreground/10', className)}>
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head>Name</Table.Head>
				<Table.Head>Email</Table.Head>
				<Table.Head>Company</Table.Head>
				<Table.Head>Status</Table.Head>
				<Table.Head>Owner</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each rows as row (row.id)}
				<Table.Row>
					<Table.Cell class="font-medium">{row.name}</Table.Cell>
					<Table.Cell class="text-muted-foreground">{row.email}</Table.Cell>
					<Table.Cell>{row.company ?? '—'}</Table.Cell>
					<Table.Cell><StatusBadge status={row.status} /></Table.Cell>
					<Table.Cell class="text-muted-foreground">{row.owner ?? '—'}</Table.Cell>
				</Table.Row>
			{:else}
				<Table.Row>
					<Table.Cell colspan={5} class="text-muted-foreground py-10 text-center">
						No contacts yet.
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>

<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import AuditLogListPage from '$lib/components/crm/audit-log-list-page.svelte';
	import { navGroupsWithActive } from './story-fixtures.js';

	const { Story } = defineMeta({
		title: 'CRM/AuditLogListPage',
		component: AuditLogListPage
	});
</script>

<script lang="ts">
	let filters = $state({
		from: '2026-08-01',
		to: '2026-08-03',
		action: '',
		actorId: ''
	});
</script>

<Story name="With rows">
	{#snippet template()}
		<div class="h-[720px]">
			<AuditLogListPage
				orgName="Corrin Data"
				navGroups={navGroupsWithActive('Audit log', 'owner')}
				bind:filters
				rows={[
					{
						id: '1',
						occurredAt: '3 Aug 2026, 15:00',
						actor: 'User · aaaaaaaa…',
						event: 'Org Config Updated',
						action: 'org.config_updated',
						target: 'organisation · bbbbbbbb…',
						ip: '192.168.5.10'
					},
					{
						id: '2',
						occurredAt: '3 Aug 2026, 14:40',
						actor: 'User · aaaaaaaa…',
						event: 'Membership Role Changed',
						action: 'membership.role_changed',
						target: 'membership · cccccccc…',
						ip: '—'
					}
				]}
			/>
		</div>
	{/snippet}
</Story>

<Story name="Empty">
	{#snippet template()}
		<div class="h-[720px]">
			<AuditLogListPage
				orgName="Corrin Data"
				navGroups={navGroupsWithActive('Audit log', 'admin')}
				rows={[]}
				filters={{ from: '', to: '', action: '', actorId: '' }}
			/>
		</div>
	{/snippet}
</Story>

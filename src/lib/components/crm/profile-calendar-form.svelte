<script lang="ts">
	import {
		calendarConnectionLabel,
		type CalendarConnectionResource
	} from '$lib/schemas/calendar-connection.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import StatusBadge from './status-badge.svelte';
	import { cn } from '$lib/utils.js';

	export interface ProfileCalendarFormProps {
		connection?: CalendarConnectionResource | null;
		connectError?: string | null;
		/** False for readonly — status still visible. */
		canEdit?: boolean;
		class?: string;
		onConnect?: () => boolean | void | Promise<boolean | void>;
		onDisconnect?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		connection = null,
		connectError = null,
		canEdit = true,
		class: className,
		onConnect,
		onDisconnect
	}: ProfileCalendarFormProps = $props();

	let pendingConnect = $state(false);
	let pendingDisconnect = $state(false);

	const status = $derived(connection?.status ?? 'disconnected');
	const connected = $derived(status === 'connected' && Boolean(connection?.credentials_configured));
	const busy = $derived(pendingConnect || pendingDisconnect);
	const statusLabel = $derived(
		status === 'connected'
			? 'Connected'
			: status === 'pending'
				? 'Pending'
				: status === 'error'
					? 'Error'
					: 'Disconnected'
	);

	async function handleConnect() {
		if (pendingConnect || !onConnect) return;
		pendingConnect = true;
		try {
			await onConnect();
		} finally {
			pendingConnect = false;
		}
	}

	async function handleDisconnect() {
		if (pendingDisconnect || !onDisconnect) return;
		pendingDisconnect = true;
		try {
			await onDisconnect();
		} finally {
			pendingDisconnect = false;
		}
	}
</script>

<div
	class={cn(
		'bg-card space-y-4 rounded-2xl border border-border p-4 md:p-5',
		className
	)}
	data-testid="profile-calendar-form"
>
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="min-w-0 space-y-1">
			<p class="font-medium">Google Calendar</p>
			<p class="text-muted-foreground text-sm" data-testid="calendar-connection-label">
				{connection ? calendarConnectionLabel(connection) : 'Not connected'}
			</p>
		</div>
		<span data-testid="calendar-connection-status">
			<StatusBadge status={statusLabel} />
		</span>
	</div>

	<p class="text-muted-foreground text-sm">
		Headquarters meetings stay the source of truth. When connected, create/update/delete pushes to
		your Google Calendar. Tokens never appear here.
	</p>

	{#if connectError}
		<p class="text-destructive text-sm" role="alert" data-testid="calendar-connect-error">
			{connectError}
		</p>
	{/if}

	{#if canEdit}
		<div class="flex flex-wrap gap-2">
			{#if connected}
				<Button
					type="button"
					variant="outline"
					disabled={busy}
					data-testid="calendar-disconnect"
					onclick={handleDisconnect}
				>
					{pendingDisconnect ? 'Disconnecting…' : 'Disconnect'}
				</Button>
			{:else}
				<Button
					type="button"
					disabled={busy || !onConnect}
					data-testid="calendar-connect"
					onclick={handleConnect}
				>
					{pendingConnect ? 'Redirecting…' : 'Connect Google Calendar'}
				</Button>
			{/if}
		</div>
	{:else}
		<p class="text-muted-foreground text-sm" data-testid="calendar-readonly-note">
			Ask an owner, admin, or member to connect Google Calendar for push sync.
		</p>
	{/if}
</div>

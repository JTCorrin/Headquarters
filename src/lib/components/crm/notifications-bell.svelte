<script lang="ts">
	import { goto } from '$app/navigation';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import { isApiClientError } from '$lib/api/v1/errors.js';
	import type { ApiUserNotification } from '$lib/api/v1/types.js';
	import { startVisibilityPoll } from '$lib/browser/visibility-poll.js';
	import { notificationDeepLink } from '$lib/crm/notification-deep-link.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { cn } from '$lib/utils.js';
	import BellIcon from '@lucide/svelte/icons/bell';

	const UNREAD_POLL_MS = 45_000;
	const LIST_LIMIT = 20;

	export interface NotificationsBellProps {
		api: ApiV1Client;
		/** When this changes, reset and re-poll for the new org. */
		orgId: string;
		/** Override navigation (tests); defaults to `goto`. */
		onNavigate?: (href: string) => void | Promise<void>;
		class?: string;
	}

	let { api, orgId, onNavigate, class: className }: NotificationsBellProps = $props();

	let open = $state(false);
	let unreadCount = $state(0);
	let items = $state<ApiUserNotification[]>([]);
	let listError = $state<string | null>(null);
	let listLoading = $state(false);
	let activatingId = $state<string | null>(null);

	function kindLabel(kind: string): string {
		switch (kind) {
			case 'email.received':
				return 'New email';
			case 'timeline.mention':
				return 'Mentioned you';
			default:
				return 'Notification';
		}
	}

	function relativeTime(iso: string): string {
		const then = Date.parse(iso);
		if (!Number.isFinite(then)) return '';
		const deltaSec = Math.round((then - Date.now()) / 1000);
		const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
		const abs = Math.abs(deltaSec);
		if (abs < 60) return rtf.format(deltaSec, 'second');
		const deltaMin = Math.round(deltaSec / 60);
		if (Math.abs(deltaMin) < 60) return rtf.format(deltaMin, 'minute');
		const deltaHr = Math.round(deltaMin / 60);
		if (Math.abs(deltaHr) < 48) return rtf.format(deltaHr, 'hour');
		const deltaDay = Math.round(deltaHr / 24);
		return rtf.format(deltaDay, 'day');
	}

	async function refreshUnread() {
		if (!orgId) return;
		try {
			const result = await api.notifications.unreadCount();
			unreadCount = Math.max(0, Math.floor(result.count));
		} catch (error) {
			if (isApiClientError(error) && error.isForbidden) {
				unreadCount = 0;
				return;
			}
			// Quiet poll — keep last known count.
		}
	}

	async function refreshList() {
		if (!orgId) return;
		listLoading = true;
		listError = null;
		try {
			const listed = await api.notifications.list({ limit: LIST_LIMIT });
			items = listed.data;
		} catch (error) {
			listError = isApiClientError(error)
				? error.message || 'Could not load notifications.'
				: 'Could not load notifications.';
			items = [];
		} finally {
			listLoading = false;
		}
	}

	async function onActivate(row: ApiUserNotification) {
		if (activatingId) return;
		activatingId = row.id;
		try {
			if (!row.read_at) {
				await api.notifications.markRead(row.id);
				items = items.map((item) =>
					item.id === row.id
						? { ...item, read_at: item.read_at ?? new Date().toISOString() }
						: item
				);
				unreadCount = Math.max(0, unreadCount - 1);
			}
			const href = notificationDeepLink(row);
			open = false;
			if (href) {
				if (onNavigate) await onNavigate(href);
				else void goto(href);
			}
		} catch (error) {
			listError = isApiClientError(error)
				? error.message || 'Could not open notification.'
				: 'Could not open notification.';
		} finally {
			activatingId = null;
		}
	}

	$effect(() => {
		void orgId;
		unreadCount = 0;
		items = [];
		listError = null;
		void refreshUnread();
	});

	$effect(() => {
		if (!orgId) return;
		return startVisibilityPoll({
			intervalMs: UNREAD_POLL_MS,
			onTick: () => {
				void refreshUnread();
			},
			onVisible: () => {
				void refreshUnread();
			}
		});
	});

	$effect(() => {
		if (open && orgId) {
			void refreshList();
			void refreshUnread();
		}
	});

	const badgeLabel = $derived(
		unreadCount > 99 ? '99+' : unreadCount > 0 ? String(unreadCount) : ''
	);
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				type="button"
				variant="outline"
				size="sm"
				class={cn('relative', className)}
				aria-label={unreadCount > 0
					? `Notifications, ${unreadCount} unread`
					: 'Notifications'}
				data-testid="notifications-bell"
				{...props}
			>
				<BellIcon class="size-4" />
				{#if badgeLabel}
					<span
						class="bg-primary text-primary-foreground absolute -end-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none"
						data-testid="notifications-badge"
					>
						{badgeLabel}
					</span>
				{/if}
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class="w-80 p-0" align="end" data-testid="notifications-panel">
		<div class="border-b px-4 py-3">
			<p class="text-sm font-semibold tracking-tight">Notifications</p>
			<p class="text-muted-foreground text-xs">
				{unreadCount > 0 ? `${unreadCount} unread` : 'You’re all caught up'}
			</p>
		</div>
		<div class="max-h-80 overflow-y-auto">
			{#if listLoading && items.length === 0}
				<p class="text-muted-foreground px-4 py-6 text-sm">Loading…</p>
			{:else if listError}
				<p class="text-destructive px-4 py-6 text-sm" role="alert">{listError}</p>
			{:else if items.length === 0}
				<p class="text-muted-foreground px-4 py-6 text-sm">No notifications yet.</p>
			{:else}
				<ul class="m-0 list-none divide-y p-0">
					{#each items as row (row.id)}
						<li>
							<button
								type="button"
								class={cn(
									'hover:bg-muted/60 flex w-full flex-col gap-0.5 px-4 py-3 text-left transition-colors',
									!row.read_at && 'bg-muted/30'
								)}
								disabled={activatingId === row.id}
								data-testid="notification-item"
								data-notification-id={row.id}
								onclick={() => {
									void onActivate(row);
								}}
							>
								<span class="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
									{kindLabel(row.kind)}
								</span>
								<span class={cn('text-sm', !row.read_at ? 'font-semibold' : 'font-medium')}>
									{row.title}
								</span>
								{#if row.body}
									<span class="text-muted-foreground line-clamp-2 text-xs">{row.body}</span>
								{/if}
								<span class="text-muted-foreground text-[11px]">{relativeTime(row.created_at)}</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</Popover.Content>
</Popover.Root>

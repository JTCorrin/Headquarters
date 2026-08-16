<script lang="ts">
	import type { AuditLogListItem } from '$lib/schemas/audit-event.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { type AppNavGroup } from './app-nav.svelte';
	import AppSidebarFrame from './app-sidebar-frame.svelte';
	import PageHeader from './page-header.svelte';
	import AuditLogTable from './audit-log-table.svelte';
	import DateField from './date-field.svelte';
	import { cn } from '$lib/utils.js';

	export interface AuditLogFilters {
		from: string;
		to: string;
		action: string;
		actorId: string;
	}

	export interface AuditLogListPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		rows: AuditLogListItem[];
		filters: AuditLogFilters;
		showNav?: boolean;
		class?: string;
		onApplyFilters?: () => void;
		onClearFilters?: () => void;
	}

	let {
		orgName,
		navGroups,
		rows,
		filters = $bindable({ from: '', to: '', action: '', actorId: '' }),
		showNav = true,
		class: className,
		onApplyFilters,
		onClearFilters
	}: AuditLogListPageProps = $props();
</script>

<AppSidebarFrame
	{orgName}
	groups={navGroups}
	{showNav}
	showTrigger={showNav}
	class={cn(
		showNav ? 'h-full min-h-svh' : 'min-h-0 flex-1 flex-col',
		className
	)}
>

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-4 py-6 sm:px-6 md:px-8">
			<PageHeader
				breadcrumb="Organisation"
				title="Audit log"
				description="Append-only security trail — Owner and Admin only. Separate from entity activity timelines."
			/>

			<form
				class="bg-card grid gap-4 rounded-3xl p-4 ring-1 ring-foreground/5 md:grid-cols-[repeat(4,minmax(0,1fr))_auto] dark:ring-foreground/10"
				data-testid="audit-log-filters"
				onsubmit={(event) => {
					event.preventDefault();
					onApplyFilters?.();
				}}
			>
				<div class="space-y-1.5">
					<Label for="audit-from">From</Label>
					<DateField
						id="audit-from"
						bind:value={filters.from}
						clearable
						presets={['today']}
						data-testid="audit-filter-from"
					/>
				</div>
				<div class="space-y-1.5">
					<Label for="audit-to">To</Label>
					<DateField
						id="audit-to"
						bind:value={filters.to}
						clearable
						presets={['today']}
						min={filters.from || undefined}
						data-testid="audit-filter-to"
					/>
				</div>
				<div class="space-y-1.5">
					<Label for="audit-action">Event</Label>
					<Input
						id="audit-action"
						bind:value={filters.action}
						placeholder="e.g. org.config_updated"
						data-testid="audit-filter-action"
					/>
				</div>
				<div class="space-y-1.5">
					<Label for="audit-actor">Actor id</Label>
					<Input
						id="audit-actor"
						bind:value={filters.actorId}
						placeholder="User uuid"
						data-testid="audit-filter-actor"
					/>
				</div>
				<div class="flex items-end gap-2 md:col-span-1">
					<Button type="submit" size="sm" data-testid="audit-filter-apply">Apply</Button>
					<Button
						type="button"
						size="sm"
						variant="outline"
						onclick={() => onClearFilters?.()}
						data-testid="audit-filter-clear"
					>
						Clear
					</Button>
				</div>
			</form>

			<AuditLogTable {rows} />
		</div>
	</main>
</AppSidebarFrame>

<script lang="ts">
	import { fromStore } from 'svelte/store';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { RecurringLineRow } from '$lib/api/v1/mappers.js';
	import type { CatalogProductOption } from '$lib/schemas/line-item.js';
	import type {
		RecurringInvoiceClientOption,
		RecurringInvoiceContactOption,
		RecurringInvoiceFormData,
		RecurringInvoiceRunListItem,
		RecurringLineFormData
	} from '$lib/schemas/recurring-invoice.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import RecurringInvoiceForm from './recurring-invoice-form.svelte';
	import RecurringLinesTable from './recurring-lines-table.svelte';
	import RecurringLineFormDrawer from './recurring-line-form-drawer.svelte';
	import RecurringInvoiceRunsTable from './recurring-invoice-runs-table.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import type { SuperForm as LineSuperForm } from 'sveltekit-superforms';

	export interface RecurringInvoiceDetailPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		title: string;
		status: string;
		scheduleForm: SuperForm<RecurringInvoiceFormData>;
		lineForm: LineSuperForm<RecurringLineFormData>;
		products?: CatalogProductOption[];
		lines?: RecurringLineRow[];
		runs?: RecurringInvoiceRunListItem[];
		lineDrawerOpen?: boolean;
		clientOptions?: RecurringInvoiceClientOption[];
		contactOptions?: RecurringInvoiceContactOption[];
		nextRunAt?: string | null;
		isEditable?: boolean;
		isDirty?: boolean;
		actionPending?: boolean;
		actionError?: string | null;
		/** When true, line drawer is correcting an existing line (not appending). */
		lineEditing?: boolean;
		onRemoveLine?: (id: string) => void;
		onAddLine?: () => boolean | void | Promise<boolean | void>;
		onPrepareAddLine?: () => void;
		onSaveSchedule?: () => boolean | void | Promise<boolean | void>;
		onActivate?: () => void | Promise<void>;
		onPause?: () => void | Promise<void>;
		onResume?: () => void | Promise<void>;
		onCancel?: () => void | Promise<void>;
		onRunNow?: () => void | Promise<void>;
		onDelete?: () => void | Promise<void>;
		onReload?: () => void | Promise<void>;
		showNav?: boolean;
		class?: string;
	}

	let {
		orgName,
		navGroups,
		title,
		status = 'Draft',
		scheduleForm,
		lineForm,
		products = [],
		lines = $bindable<RecurringLineRow[]>([]),
		runs = [],
		lineDrawerOpen = $bindable(false),
		clientOptions = [],
		contactOptions = [],
		nextRunAt = null,
		isEditable = true,
		isDirty = false,
		actionPending = false,
		actionError = null,
		lineEditing = false,
		onRemoveLine,
		onAddLine,
		onPrepareAddLine,
		onSaveSchedule,
		onActivate,
		onPause,
		onResume,
		onCancel,
		onRunNow,
		onDelete,
		onReload,
		showNav = true,
		class: className
	}: RecurringInvoiceDetailPageProps = $props();

	const formData = fromStore(scheduleForm.form);
	const statusLower = $derived(status.toLowerCase());
</script>

<div
	class={cn(
		'bg-background text-foreground flex',
		showNav ? 'h-full min-h-svh' : 'min-h-0 flex-1 flex-col',
		className
	)}
>
	{#if showNav}
		<AppNav {orgName} groups={navGroups} class="h-full shrink-0 self-stretch" />
	{/if}

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-6 py-6 md:px-8">
			<PageHeader
				breadcrumb="Accounting / Recurring invoices"
				{title}
				{status}
				description="Edit schedule configuration and lines. Lifecycle commands use optimistic concurrency (ETag)."
			>
				{#snippet actions()}
					{#if statusLower === 'draft'}
						<Button
							variant="outline"
							size="sm"
							disabled={actionPending}
							onclick={() => onDelete?.()}
						>
							Delete draft
						</Button>
						<Button
							size="sm"
							disabled={actionPending || isDirty}
							title={isDirty ? 'Save changes before activating' : undefined}
							onclick={() => onActivate?.()}
						>
							Activate
						</Button>
					{:else if statusLower === 'active'}
						<Button
							variant="outline"
							size="sm"
							disabled={actionPending}
							onclick={() => onPause?.()}
						>
							Pause
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={actionPending}
							onclick={() => onCancel?.()}
						>
							Cancel
						</Button>
					{:else if statusLower === 'paused'}
						<Button
							size="sm"
							disabled={actionPending}
							onclick={() => onResume?.()}
						>
							Resume
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={actionPending}
							onclick={() => onCancel?.()}
						>
							Cancel
						</Button>
					{/if}
					{#if statusLower === 'draft' || statusLower === 'active' || statusLower === 'paused'}
						<Button
							variant="secondary"
							size="sm"
							disabled={actionPending || isDirty}
							title={isDirty ? 'Save changes before run now' : undefined}
							onclick={() => onRunNow?.()}
						>
							Run now
						</Button>
					{/if}
					{#if actionError}
						<Button variant="ghost" size="sm" onclick={() => onReload?.()}>Reload</Button>
					{/if}
				{/snippet}
			</PageHeader>

			{#if actionError}
				<p class="text-destructive text-sm" role="alert">{actionError}</p>
			{/if}

			{#if nextRunAt && statusLower === 'active'}
				<p class="text-muted-foreground text-sm">Next run: {nextRunAt}</p>
			{/if}

			<div class="grid gap-6 lg:grid-cols-2">
				<div class="space-y-6">
					<div
						class="bg-card rounded-3xl p-6 ring-1 ring-foreground/5 dark:ring-foreground/10"
					>
						<RecurringInvoiceForm
							form={scheduleForm}
							submitLabel="Save schedule"
							{clientOptions}
							{contactOptions}
							readonly={!isEditable}
							onValidSubmit={onSaveSchedule}
						/>
					</div>

					<RecurringLinesTable
						rows={lines}
						readonly={!isEditable}
						{onRemoveLine}
					>
						{#snippet headerActions()}
							{#if isEditable}
								<RecurringLineFormDrawer
									bind:open={lineDrawerOpen}
									form={lineForm}
									{products}
									onValidSubmit={onAddLine}
									submitLabel={lineEditing ? 'Update line' : 'Add line'}
									triggerLabel="Add line"
									title={lineEditing ? 'Fix schedule line' : 'Add schedule line'}
									description={lineEditing
										? 'Correct the highlighted fields, then save the schedule again.'
										: 'Lines copy into each generated invoice snapshot.'}
								>
									{#snippet trigger()}
										<Button
											type="button"
											size="sm"
											variant="outline"
											onclick={() => onPrepareAddLine?.()}
										>
											<PlusIcon class="mr-1 size-4" />
											Add line
										</Button>
									{/snippet}
								</RecurringLineFormDrawer>
							{/if}
						{/snippet}
					</RecurringLinesTable>
				</div>

				<RecurringInvoiceRunsTable rows={runs} />
			</div>
		</div>
	</main>
</div>

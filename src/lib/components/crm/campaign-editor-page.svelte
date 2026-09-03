<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { ApiCampaignAudiencePreview, ApiEmailTemplate, ApiOrgMailbox, ApiTag } from '$lib/api/v1/types.js';
	import type { CampaignFormData } from '$lib/schemas/campaign.js';
	import { type AppNavGroup } from './app-nav.svelte';
	import AppSidebarFrame from './app-sidebar-frame.svelte';
	import PageHeader from './page-header.svelte';
	import ResourceStateBanner, {
		type ResourceViewState
	} from './resource-state-banner.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { cn } from '$lib/utils.js';

	export interface CampaignEditorPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		title: string;
		status?: string;
		form: SuperForm<CampaignFormData>;
		templates: ApiEmailTemplate[];
		mailboxes: ApiOrgMailbox[];
		orgTags: ApiTag[];
		preview?: ApiCampaignAudiencePreview | null;
		previewLoading?: boolean;
		busy?: boolean;
		viewState?: ResourceViewState;
		showNav?: boolean;
		class?: string;
		onReload?: () => void;
		onSave?: () => void | Promise<void>;
		onPreview?: () => void | Promise<void>;
		onLaunch?: () => void | Promise<void>;
		onSchedule?: () => void | Promise<void>;
		onBack?: () => void;
		onDelete?: () => void;
	}

	let {
		orgName,
		navGroups,
		title,
		status = 'Draft',
		form,
		templates,
		mailboxes,
		orgTags,
		preview = null,
		previewLoading = false,
		busy = false,
		viewState = { kind: 'ready' },
		showNav = true,
		class: className,
		onReload,
		onSave,
		onPreview,
		onLaunch,
		onSchedule,
		onBack,
		onDelete
	}: CampaignEditorPageProps = $props();

	const formData = untrack(() => form.form);
	const errors = untrack(() => form.errors);

	const entityTypeOptions = [
		{ value: 'lead', label: 'Leads' },
		{ value: 'contact', label: 'Contacts' },
		{ value: 'client', label: 'Clients' }
	] as const;

	const sortedTemplates = $derived(
		[...templates].sort((a, b) => {
			if (a.category === 'campaign' && b.category !== 'campaign') return -1;
			if (b.category === 'campaign' && a.category !== 'campaign') return 1;
			return a.name.localeCompare(b.name);
		})
	);

	function templateLabel(id: string): string {
		return templates.find((t) => t.id === id)?.name ?? 'Select template';
	}

	function mailboxLabel(id: string): string {
		const mailbox = mailboxes.find((m) => m.id === id);
		if (!mailbox) return 'Select mailbox';
		const owner = mailbox.member_display_name ? ` (${mailbox.member_display_name})` : '';
		return `${mailbox.from_name ? `${mailbox.from_name} ` : ''}<${mailbox.email_address}>${owner}`;
	}

	function toggleEntityType(value: 'lead' | 'contact' | 'client') {
		const current = new Set($formData.entity_types);
		if (current.has(value)) current.delete(value);
		else current.add(value);
		form.form.update((data) => ({
			...data,
			entity_types: [...current] as CampaignFormData['entity_types']
		}));
	}

	function toggleTag(tagId: string) {
		const current = new Set($formData.tag_ids);
		if (current.has(tagId)) current.delete(tagId);
		else current.add(tagId);
		form.form.update((data) => ({
			...data,
			tag_ids: [...current]
		}));
	}

	function toLocalDatetimeValue(iso: string): string {
		if (!iso) return '';
		const date = new Date(iso);
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
	}

	function fromLocalDatetimeValue(value: string): string {
		if (!value) return '';
		return new Date(value).toISOString();
	}
</script>

<AppSidebarFrame
	{orgName}
	groups={navGroups}
	{showNav}
	showTrigger={showNav}
	class={cn(
		showNav ? 'h-full min-h-[720px]' : 'min-h-0 flex-1 flex-col',
		className
	)}
>
	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-4 py-6 sm:px-6 md:px-8">
			{#if viewState.kind !== 'ready' && viewState.kind !== 'validation'}
				<ResourceStateBanner state={viewState} onReload={onReload} />
			{:else}
				{#if viewState.kind === 'validation'}
					<ResourceStateBanner state={viewState} onReload={onReload} />
				{/if}

				<PageHeader
					breadcrumb="Comms / Campaigns"
					{title}
					{status}
					description="Configure audience tags, template, and sending mailbox."
				>
					{#snippet actions()}
						{#if onBack}
							<Button type="button" variant="outline" size="sm" onclick={onBack}>Back</Button>
						{/if}
						{#if onDelete}
							<Button type="button" variant="outline" size="sm" onclick={onDelete}>Delete</Button>
						{/if}
						{#if onSave}
							<Button type="button" size="sm" disabled={busy} onclick={() => void onSave?.()}>
								Save
							</Button>
						{/if}
						{#if onPreview}
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={busy || previewLoading}
								onclick={() => void onPreview?.()}
							>
								{previewLoading ? 'Previewing…' : 'Audience preview'}
							</Button>
						{/if}
						{#if onSchedule && $formData.scheduled_at}
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={busy}
								onclick={() => void onSchedule?.()}
							>
								Schedule
							</Button>
						{/if}
						{#if onLaunch}
							<Button type="button" size="sm" disabled={busy} onclick={() => void onLaunch?.()}>
								Launch now
							</Button>
						{/if}
					{/snippet}
				</PageHeader>

				<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
					<form class="space-y-5" onsubmit={(e) => e.preventDefault()}>
						<div class="space-y-2">
							<Label for="campaign-name">Name</Label>
							<Input
								id="campaign-name"
								bind:value={$formData.name}
								placeholder="Spring outreach"
								disabled={busy}
							/>
							{#if $errors.name}
								<p class="text-destructive text-sm">{$errors.name}</p>
							{/if}
						</div>

						<div class="space-y-2">
							<Label>Template</Label>
							<Select.Root type="single" bind:value={$formData.template_id} disabled={busy}>
								<Select.Trigger class="w-full">
									{templateLabel($formData.template_id)}
								</Select.Trigger>
								<Select.Content>
									{#each sortedTemplates as template (template.id)}
										<Select.Item value={template.id}>
											{template.name}
											{#if template.category === 'campaign'}
												<span class="text-muted-foreground"> · campaign</span>
											{/if}
										</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
							{#if $errors.template_id}
								<p class="text-destructive text-sm">{$errors.template_id}</p>
							{/if}
						</div>

						<div class="space-y-2">
							<Label>Send from</Label>
							<Select.Root type="single" bind:value={$formData.mailbox_id} disabled={busy}>
								<Select.Trigger class="w-full">
									{mailboxLabel($formData.mailbox_id)}
								</Select.Trigger>
								<Select.Content>
									{#each mailboxes as mailbox (mailbox.id)}
										<Select.Item value={mailbox.id}>
											{mailboxLabel(mailbox.id)}
										</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
							{#if $errors.mailbox_id}
								<p class="text-destructive text-sm">{$errors.mailbox_id}</p>
							{/if}
						</div>

						<div class="space-y-2">
							<Label>Audience tags</Label>
							<div class="flex flex-wrap gap-2">
								{#each orgTags as tag (tag.id)}
									<button
										type="button"
										class="focus-visible:ring-ring rounded-full focus-visible:ring-2 focus-visible:outline-none"
										disabled={busy}
										onclick={() => toggleTag(tag.id)}
									>
										<Badge
											variant={$formData.tag_ids.includes(tag.id) ? 'default' : 'outline'}
										>
											{tag.name}
										</Badge>
									</button>
								{:else}
									<p class="text-muted-foreground text-sm">No tags in this organisation yet.</p>
								{/each}
							</div>
						</div>

						<div class="space-y-2">
							<Label>Include entity types</Label>
							<div class="flex flex-wrap gap-4">
								{#each entityTypeOptions as option (option.value)}
									<label class="flex items-center gap-2 text-sm">
										<input
											type="checkbox"
											class="size-4 rounded border"
											checked={$formData.entity_types.includes(option.value)}
											disabled={busy}
											onchange={() => toggleEntityType(option.value)}
										/>
										{option.label}
									</label>
								{/each}
							</div>
							{#if $errors.entity_types}
								<p class="text-destructive text-sm">{$errors.entity_types}</p>
							{/if}
						</div>

						<div class="space-y-2">
							<Label for="campaign-scheduled-at">Schedule for (optional)</Label>
							<Input
								id="campaign-scheduled-at"
								type="datetime-local"
								value={toLocalDatetimeValue($formData.scheduled_at ?? '')}
								disabled={busy}
								oninput={(event) => {
									const value = (event.currentTarget as HTMLInputElement).value;
									form.form.update((data) => ({
										...data,
										scheduled_at: value ? fromLocalDatetimeValue(value) : ''
									}));
								}}
							/>
						</div>
					</form>

					<aside class="space-y-4 rounded-lg border p-4">
						<h2 class="text-sm font-medium">Audience preview</h2>
						{#if previewLoading}
							<p class="text-muted-foreground text-sm">Calculating audience…</p>
						{:else if preview}
							<dl class="space-y-2 text-sm">
								<div class="flex justify-between gap-4">
									<dt class="text-muted-foreground">Sendable</dt>
									<dd class="font-medium">{preview.sendable}</dd>
								</div>
								<div class="flex justify-between gap-4">
									<dt class="text-muted-foreground">Skipped</dt>
									<dd>{preview.skipped}</dd>
								</div>
								<div class="flex justify-between gap-4">
									<dt class="text-muted-foreground">Total resolved</dt>
									<dd>{preview.total}</dd>
								</div>
							</dl>
							{#if preview.capped}
								<p class="text-muted-foreground text-xs">Preview capped at 500 matches.</p>
							{/if}
							{#if preview.sample.length > 0}
								<ul class="text-muted-foreground space-y-1 text-xs">
									{#each preview.sample.slice(0, 5) as row, index (index)}
										<li>{row.to_name ?? row.entity_type} · {row.to_email ?? 'no email'}</li>
									{/each}
								</ul>
							{/if}
						{:else}
							<p class="text-muted-foreground text-sm">
								Save the draft, then run audience preview to see sendable counts.
							</p>
						{/if}
					</aside>
				</div>
			{/if}
		</div>
	</main>
</AppSidebarFrame>

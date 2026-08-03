<script lang="ts">
	import { fromStore } from 'svelte/store';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { EmailTemplateFormData } from '$lib/schemas/email-template.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import EmailTemplateForm from './email-template-form.svelte';
	import ResourceStateBanner, {
		type ResourceViewState
	} from './resource-state-banner.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface EmailTemplateEditorPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		title: string;
		status?: string;
		form: SuperForm<EmailTemplateFormData>;
		sampleVars?: Record<string, string>;
		viewState?: ResourceViewState;
		/** When false, omit AppNav (shell already renders it at full window height). */
		showNav?: boolean;
		class?: string;
		onReload?: () => void;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
		onBack?: () => void;
	}

	let {
		orgName,
		navGroups,
		title,
		status = 'Draft',
		form,
		sampleVars = {
			'contact.name': 'Ava',
			'client.name': 'Northwind',
			'invoice.number': 'INV-0881',
			'quote.number': 'Q-0142'
		},
		viewState = { kind: 'ready' },
		showNav = true,
		class: className,
		onReload,
		onValidSubmit,
		onBack
	}: EmailTemplateEditorPageProps = $props();

	const formData = fromStore(form.form);

	function renderTemplate(text: string): string {
		return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => sampleVars[key] ?? `{{${key}}}`);
	}

	const previewSubject = $derived(renderTemplate(formData.current.subject || '(no subject)'));
	const previewBody = $derived(renderTemplate(formData.current.body || ''));
</script>

<div
	class={cn(
		'bg-background text-foreground flex',
		showNav ? 'h-full min-h-[720px]' : 'min-h-0 flex-1 flex-col',
		className
	)}
>
	{#if showNav}
		<AppNav {orgName} groups={navGroups} class="shrink-0" />
	{/if}

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-6 py-6 md:px-8">
			{#if viewState.kind !== 'ready' && viewState.kind !== 'validation'}
				<ResourceStateBanner state={viewState} onReload={onReload} />
			{:else}
				{#if viewState.kind === 'validation'}
					<ResourceStateBanner state={viewState} onReload={onReload} />
				{/if}
				<PageHeader
					breadcrumb="Comms / Email templates"
					{title}
					{status}
					description="Edit on the left — sample-variable preview on the right."
				>
					{#snippet actions()}
						{#if onBack}
							<Button type="button" variant="outline" size="sm" onclick={onBack}>Back</Button>
						{/if}
					{/snippet}
				</PageHeader>

				<div class="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
					<section
						class="bg-card self-start space-y-4 rounded-3xl p-5 ring-1 ring-foreground/5 dark:ring-foreground/10"
					>
						<h2 class="text-sm font-semibold tracking-tight">Template</h2>
						<EmailTemplateForm {form} submitLabel="Save template" {onValidSubmit} />
					</section>

					<section
						class="bg-muted/40 xl:sticky xl:top-6 self-start overflow-hidden rounded-3xl ring-1 ring-foreground/5 dark:ring-foreground/10"
					>
						<div class="px-4 py-3">
							<p class="text-sm font-semibold tracking-tight">Live preview</p>
							<p class="text-muted-foreground text-xs">Sample contact / client variables</p>
						</div>
						<div
							class="border-border/80 space-y-3 border-t bg-white p-5 text-black dark:bg-zinc-950 dark:text-zinc-50"
						>
							<p class="text-muted-foreground text-[11px] uppercase tracking-wide">Subject</p>
							<p class="text-sm font-semibold">{previewSubject}</p>
							<p class="text-muted-foreground pt-2 text-[11px] uppercase tracking-wide">Body</p>
							<pre
								class="font-sans text-sm leading-relaxed whitespace-pre-wrap">{previewBody ||
									'Start typing to preview…'}</pre>
						</div>
					</section>
				</div>
			{/if}
		</div>
	</main>
</div>

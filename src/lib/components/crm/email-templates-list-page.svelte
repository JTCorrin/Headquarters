<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { EmailTemplateFormData } from '$lib/schemas/email-template.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import EmailTemplatesTable from './email-templates-table.svelte';
	import type { EmailTemplateRow } from './email-templates-columns.js';
	import EmailTemplateFormDrawer from './email-template-form-drawer.svelte';
	import ResourceStateBanner, {
		type ResourceViewState
	} from './resource-state-banner.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface EmailTemplatesListPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		rows: EmailTemplateRow[];
		form: SuperForm<EmailTemplateFormData>;
		drawerOpen?: boolean;
		viewState?: ResourceViewState;
		/** When false, omit AppNav (shell already renders it at full window height). */
		showNav?: boolean;
		class?: string;
		onReload?: () => void;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
		onNewTemplate?: () => void;
	}

	let {
		orgName,
		navGroups,
		rows,
		form,
		drawerOpen = $bindable(false),
		viewState = { kind: 'ready' },
		showNav = true,
		class: className,
		onReload,
		onValidSubmit,
		onNewTemplate
	}: EmailTemplatesListPageProps = $props();
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
			{#if viewState.kind === 'empty' || viewState.kind === 'validation'}
				<ResourceStateBanner state={viewState} onReload={onReload} />
			{/if}

			<PageHeader
				breadcrumb="Comms"
				title="Email templates"
				description="Reusable subjects and bodies for transactional mail, chases, and campaigns."
			>
				{#snippet actions()}
					{#if onNewTemplate}
						<Button type="button" size="sm" onclick={onNewTemplate}>New template</Button>
					{:else}
						<EmailTemplateFormDrawer bind:open={drawerOpen} {form} {onValidSubmit}>
							{#snippet trigger()}
								<Button type="button" size="sm">New template</Button>
							{/snippet}
						</EmailTemplateFormDrawer>
					{/if}
				{/snippet}
			</PageHeader>

			<EmailTemplatesTable {rows} />
		</div>
	</main>
</div>

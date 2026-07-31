<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { EmailTemplateFormData } from '$lib/schemas/email-template.js';
	import AppNav, { type AppNavGroup } from './app-nav.svelte';
	import PageHeader from './page-header.svelte';
	import EmailTemplatesTable from './email-templates-table.svelte';
	import type { EmailTemplateRow } from './email-templates-columns.js';
	import EmailTemplateFormDrawer from './email-template-form-drawer.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	export interface EmailTemplatesListPageProps {
		orgName: string;
		navGroups: AppNavGroup[];
		rows: EmailTemplateRow[];
		form: SuperForm<EmailTemplateFormData>;
		drawerOpen?: boolean;
		class?: string;
	}

	let {
		orgName,
		navGroups,
		rows,
		form,
		drawerOpen = $bindable(false),
		class: className
	}: EmailTemplatesListPageProps = $props();
</script>

<div class={cn('bg-background text-foreground flex h-full min-h-[720px]', className)}>
	<AppNav {orgName} groups={navGroups} class="shrink-0" />

	<main class="flex min-w-0 flex-1 flex-col">
		<div class="space-y-6 px-6 py-6 md:px-8">
			<PageHeader
				breadcrumb="Comms"
				title="Email templates"
				description="Reusable subjects and bodies for transactional mail, chases, and campaigns."
			>
				{#snippet actions()}
					<EmailTemplateFormDrawer bind:open={drawerOpen} {form}>
						{#snippet trigger()}
							<Button type="button" size="sm">New template</Button>
						{/snippet}
					</EmailTemplateFormDrawer>
				{/snippet}
			</PageHeader>

			<EmailTemplatesTable {rows} />
		</div>
	</main>
</div>

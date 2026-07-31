<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { OrganisationCreateData } from '$lib/schemas/organisation.js';
	import * as Drawer from '$lib/components/ui/drawer/index.js';
	import OrganisationCreateForm from './organisation-create-form.svelte';
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	export interface OrganisationCreateDrawerProps {
		form: SuperForm<OrganisationCreateData>;
		open?: boolean;
		createError?: string | null;
		class?: string;
		trigger?: Snippet;
		/**
		 * Called after client-side validation succeeds.
		 * Return `false` or reject to keep the drawer open;
		 * return `true`/void to close after success.
		 */
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		open = $bindable(false),
		createError = null,
		class: className,
		trigger,
		onValidSubmit
	}: OrganisationCreateDrawerProps = $props();

	let localError = $state<string | null>(null);
	const displayError = $derived(createError ?? localError);

	async function handleValidSubmit(): Promise<boolean> {
		localError = null;
		try {
			const result = await onValidSubmit?.();
			if (result === false) {
				if (!createError && !localError) {
					localError = 'Could not create organisation — try again.';
				}
				return false;
			}
			open = false;
			return true;
		} catch (err) {
			localError =
				err instanceof Error ? err.message : 'Could not create organisation — try again.';
			return false;
		}
	}
</script>

<Drawer.Root bind:open direction="right" shouldScaleBackground={false}>
	{#if trigger}
		<Drawer.Trigger>
			{#snippet child({ props })}
				<span {...props}>{@render trigger()}</span>
			{/snippet}
		</Drawer.Trigger>
	{/if}
	<Drawer.Content
		class={cn('mx-auto w-full max-w-md', className)}
		data-testid="organisation-create-drawer"
	>
		<Drawer.Header class="text-left">
			<Drawer.Title>Create organisation</Drawer.Title>
			<Drawer.Description>
				Creates the organisation and makes you Owner, then opens its configuration.
			</Drawer.Description>
		</Drawer.Header>
		<div class="space-y-3 px-4 pb-6">
			{#if displayError}
				<p class="text-destructive text-sm" role="alert" data-testid="organisation-create-error">
					{displayError}
				</p>
			{/if}
			<OrganisationCreateForm {form} onValidSubmit={handleValidSubmit} />
		</div>
	</Drawer.Content>
</Drawer.Root>

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
		class?: string;
		trigger?: Snippet;
		onValidSubmit?: () => void;
	}

	let {
		form,
		open = $bindable(false),
		class: className,
		trigger,
		onValidSubmit
	}: OrganisationCreateDrawerProps = $props();
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
		<div class="px-4 pb-6">
			<OrganisationCreateForm
				{form}
				onValidSubmit={() => {
					onValidSubmit?.();
					open = false;
				}}
			/>
		</div>
	</Drawer.Content>
</Drawer.Root>

<script lang="ts">
	import { get } from 'svelte/store';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { ApiV1Client } from '$lib/api/v1/client.js';
	import type { MeetingFormData } from '$lib/schemas/meeting.js';
	import {
		loadMeetingRelatedEntityOptions,
		type MeetingRelatedEntityOption,
		type MeetingRelatedEntityType
	} from '$lib/crm/meeting-related-entities.js';
	import * as Drawer from '$lib/components/ui/drawer/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import MeetingForm from './meeting-form.svelte';
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	export interface MeetingFormDrawerProps {
		form: SuperForm<MeetingFormData>;
		api?: ApiV1Client | null;
		open?: boolean;
		title?: string;
		description?: string;
		submitLabel?: string;
		triggerLabel?: string;
		showTrigger?: boolean;
		class?: string;
		trigger?: Snippet;
		onValidSubmit?: () => boolean | void | Promise<boolean | void>;
	}

	let {
		form,
		api = null,
		open = $bindable(false),
		title = 'Schedule meeting',
		description = 'Link attendees and a client, contact, lead, or project when you know them.',
		submitLabel = 'Save meeting',
		triggerLabel = 'New meeting',
		showTrigger = true,
		class: className,
		trigger,
		onValidSubmit
	}: MeetingFormDrawerProps = $props();

	let relatedEntityOptions = $state<MeetingRelatedEntityOption[]>([]);
	let relatedEntityLoading = $state(false);
	let loadToken = 0;

	async function loadRelated(type: MeetingFormData['relatedEntityType']) {
		if (!api || type === 'none') {
			relatedEntityOptions = [];
			relatedEntityLoading = false;
			return;
		}
		const token = ++loadToken;
		relatedEntityLoading = true;
		try {
			const options = await loadMeetingRelatedEntityOptions(
				api,
				type as MeetingRelatedEntityType
			);
			if (token !== loadToken) return;
			relatedEntityOptions = options;
		} catch {
			if (token !== loadToken) return;
			relatedEntityOptions = [];
		} finally {
			if (token === loadToken) relatedEntityLoading = false;
		}
	}

	$effect(() => {
		if (!open) return;
		const type = get(form.form).relatedEntityType;
		void loadRelated(type);
	});
</script>

<Drawer.Root bind:open direction="bottom" shouldScaleBackground={false}>
	{#if showTrigger}
		{#if trigger}
			<Drawer.Trigger>
				{#snippet child({ props })}
					<span class="inline-flex" {...props}>{@render trigger()}</span>
				{/snippet}
			</Drawer.Trigger>
		{:else}
			<Drawer.Trigger>
				{#snippet child({ props })}
					<Button type="button" size="sm" {...props}>{triggerLabel}</Button>
				{/snippet}
			</Drawer.Trigger>
		{/if}
	{/if}

	<Drawer.Content class={cn('mx-auto w-full max-w-lg', className)}>
		<Drawer.Header class="text-left">
			<Drawer.Title>{title}</Drawer.Title>
			<Drawer.Description>{description}</Drawer.Description>
		</Drawer.Header>
		<div class="overflow-y-auto px-4 pb-2">
			<MeetingForm
				{form}
				{submitLabel}
				{onValidSubmit}
				{relatedEntityOptions}
				{relatedEntityLoading}
				onRelatedEntityTypeChange={(type) => {
					void loadRelated(type);
				}}
				class="max-w-none"
			/>
		</div>
		<Drawer.Footer class="pt-0">
			<Drawer.Close>
				<Button type="button" variant="outline">Cancel</Button>
			</Drawer.Close>
		</Drawer.Footer>
	</Drawer.Content>
</Drawer.Root>

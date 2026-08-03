<script lang="ts">
	import type { TimelineIconId } from './timeline-accents.js';
	import StickyNoteIcon from '@lucide/svelte/icons/sticky-note';
	import MailIcon from '@lucide/svelte/icons/mail';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import CircleDollarSignIcon from '@lucide/svelte/icons/circle-dollar-sign';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import ArrowRightLeftIcon from '@lucide/svelte/icons/arrow-right-left';
	import UsersIcon from '@lucide/svelte/icons/users';
	import CheckSquareIcon from '@lucide/svelte/icons/square-check';
	import FlagIcon from '@lucide/svelte/icons/flag';
	import StarIcon from '@lucide/svelte/icons/star';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { cn } from '$lib/utils.js';

	export interface TimelineIconProps {
		name: TimelineIconId | string;
		class?: string;
	}

	let { name, class: className }: TimelineIconProps = $props();
</script>

{#if name === 'email'}
	<MailIcon class={cn('size-3.5', className)} />
{:else if name === 'call'}
	<PhoneIcon class={cn('size-3.5', className)} />
{:else if name === 'payment'}
	<CircleDollarSignIcon class={cn('size-3.5', className)} />
{:else if name === 'document'}
	<FileTextIcon class={cn('size-3.5', className)} />
{:else if name === 'status'}
	<ArrowRightLeftIcon class={cn('size-3.5', className)} />
{:else if name === 'conversion'}
	<ArrowRightLeftIcon class={cn('size-3.5', className)} />
{:else if name === 'meeting'}
	<UsersIcon class={cn('size-3.5', className)} />
{:else if name === 'task'}
	<CheckSquareIcon class={cn('size-3.5', className)} />
{:else if name === 'flag'}
	<FlagIcon class={cn('size-3.5', className)} />
{:else if name === 'star'}
	<StarIcon class={cn('size-3.5', className)} />
{:else if name === 'alert'}
	<TriangleAlertIcon class={cn('size-3.5', className)} />
{:else}
	<StickyNoteIcon class={cn('size-3.5', className)} />
{/if}

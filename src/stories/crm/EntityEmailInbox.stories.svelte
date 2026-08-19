<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import EntityEmailInbox from '$lib/components/crm/entity-email-inbox.svelte';
	import { sampleEmailMessages } from './story-fixtures.js';

	const noopCreateLead = () => {};

	const overflowMessages = [
		...sampleEmailMessages,
		{
			id: 'extra-1',
			direction: 'in',
			from: 'ops@northwind.com',
			fromAddress: 'ops@northwind.com',
			fromName: null,
			to: 'joe@acme.test',
			subject: 'Thread note 1',
			preview: 'Extra message so the inbox list overflows and scrolls.',
			body: 'Body for overflow message 1.',
			occurredAt: 'Mar 10'
		},
		{
			id: 'extra-2',
			direction: 'out',
			from: 'joe@acme.test',
			fromAddress: 'joe@acme.test',
			fromName: null,
			to: 'ops@northwind.com',
			subject: 'Thread note 2',
			preview: 'Extra message so the inbox list overflows and scrolls.',
			body: 'Body for overflow message 2.',
			occurredAt: 'Mar 11'
		},
		{
			id: 'extra-3',
			direction: 'in',
			from: 'ops@northwind.com',
			fromAddress: 'ops@northwind.com',
			fromName: null,
			to: 'joe@acme.test',
			subject: 'Thread note 3',
			preview: 'Extra message so the inbox list overflows and scrolls.',
			body: 'Body for overflow message 3.',
			occurredAt: 'Mar 12'
		},
		{
			id: 'extra-4',
			direction: 'out',
			from: 'joe@acme.test',
			fromAddress: 'joe@acme.test',
			fromName: null,
			to: 'ops@northwind.com',
			subject: 'Thread note 4',
			preview: 'Extra message so the inbox list overflows and scrolls.',
			body: 'Body for overflow message 4.',
			occurredAt: 'Mar 13'
		},
		{
			id: 'extra-5',
			direction: 'in',
			from: 'ops@northwind.com',
			fromAddress: 'ops@northwind.com',
			fromName: null,
			to: 'joe@acme.test',
			subject: 'Thread note 5',
			preview: 'Extra message so the inbox list overflows and scrolls.',
			body: 'Body for overflow message 5.',
			occurredAt: 'Mar 14'
		},
		{
			id: 'extra-6',
			direction: 'out',
			from: 'joe@acme.test',
			fromAddress: 'joe@acme.test',
			fromName: null,
			to: 'ops@northwind.com',
			subject: 'Thread note 6',
			preview: 'Extra message so the inbox list overflows and scrolls.',
			body: 'Body for overflow message 6.',
			occurredAt: 'Mar 15'
		},
		{
			id: 'extra-7',
			direction: 'in',
			from: 'ops@northwind.com',
			fromAddress: 'ops@northwind.com',
			fromName: null,
			to: 'joe@acme.test',
			subject: 'Thread note 7',
			preview: 'Extra message so the inbox list overflows and scrolls.',
			body: 'Body for overflow message 7.',
			occurredAt: 'Mar 16'
		},
		{
			id: 'extra-8',
			direction: 'out',
			from: 'joe@acme.test',
			fromAddress: 'joe@acme.test',
			fromName: null,
			to: 'ops@northwind.com',
			subject: 'Thread note 8',
			preview: 'Extra message so the inbox list overflows and scrolls.',
			body: 'Body for overflow message 8.',
			occurredAt: 'Mar 17'
		},
		{
			id: 'extra-9',
			direction: 'in',
			from: 'ops@northwind.com',
			fromAddress: 'ops@northwind.com',
			fromName: null,
			to: 'joe@acme.test',
			subject: 'Thread note 9',
			preview: 'Extra message so the inbox list overflows and scrolls.',
			body: 'Body for overflow message 9.',
			occurredAt: 'Mar 18'
		},
		{
			id: 'extra-10',
			direction: 'out',
			from: 'joe@acme.test',
			fromAddress: 'joe@acme.test',
			fromName: null,
			to: 'ops@northwind.com',
			subject: 'Thread note 10',
			preview: 'Extra message so the inbox list overflows and scrolls.',
			body: 'Body for overflow message 10.',
			occurredAt: 'Mar 19'
		}
	];

	const { Story } = defineMeta({
		title: 'Headquarters/EntityEmailInbox',
		component: EntityEmailInbox,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' }
	});
</script>

<Story
	name="Default"
	args={{
		messages: sampleEmailMessages,
		mailboxConnected: true,
		aiProviderConnected: true,
		smtpReady: true,
		role: 'owner'
	}}
>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/entity-email-inbox.svelte').EntityEmailInboxProps} */ (
				args
			)}
		<div class="h-screen bg-background p-4">
			<EntityEmailInbox {...props} class="h-full" />
		</div>
	{/snippet}
</Story>

<Story
	name="CreateLead"
	args={{
		messages: sampleEmailMessages,
		mailboxConnected: true,
		aiProviderConnected: true,
		smtpReady: true,
		role: 'owner',
		canCreateLead: true,
		canAddToTimeline: false,
		onCreateLead: noopCreateLead
	}}
>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/entity-email-inbox.svelte').EntityEmailInboxProps} */ (
				args
			)}
		<div class="h-screen bg-background p-4">
			<EntityEmailInbox {...props} class="h-full" />
		</div>
	{/snippet}
</Story>

<Story
	name="ScrollableInbox"
	args={{
		messages: overflowMessages,
		mailboxConnected: true,
		aiProviderConnected: true,
		smtpReady: true,
		role: 'owner'
	}}
>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/entity-email-inbox.svelte').EntityEmailInboxProps} */ (
				args
			)}
		<div class="h-screen bg-background p-4">
			<EntityEmailInbox {...props} class="h-full" />
		</div>
	{/snippet}
</Story>

<Story
	name="EmptyNoMailbox"
	args={{
		messages: [],
		emptyState: 'no_mailbox',
		mailboxConnected: false,
		aiProviderConnected: false,
		role: 'owner'
	}}
>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/entity-email-inbox.svelte').EntityEmailInboxProps} */ (
				args
			)}
		<div class="h-screen bg-background p-4">
			<EntityEmailInbox {...props} class="h-full" />
		</div>
	{/snippet}
</Story>

<Story
	name="EmptyNoMatches"
	args={{
		messages: [],
		emptyState: 'no_matches',
		mailboxConnected: true,
		aiProviderConnected: true,
		role: 'owner'
	}}
>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/entity-email-inbox.svelte').EntityEmailInboxProps} */ (
				args
			)}
		<div class="h-screen bg-background p-4">
			<EntityEmailInbox {...props} class="h-full" />
		</div>
	{/snippet}
</Story>

<Story
	name="EmptyTeammateNothingShared"
	args={{
		messages: [],
		emptyState: 'teammate_nothing_shared',
		mailboxConnected: false,
		aiProviderConnected: false,
		role: 'member'
	}}
>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/entity-email-inbox.svelte').EntityEmailInboxProps} */ (
				args
			)}
		<div class="h-screen bg-background p-4">
			<EntityEmailInbox {...props} class="h-full" />
		</div>
	{/snippet}
</Story>

<Story
	name="Compose"
	args={{
		messages: [],
		emptyState: 'no_matches',
		mailboxConnected: true,
		aiProviderConnected: true,
		smtpReady: true,
		role: 'owner',
		defaultTo: 'ava@northwind.com',
		composingNew: true
	}}
>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/entity-email-inbox.svelte').EntityEmailInboxProps} */ (
				args
			)}
		<div class="h-screen bg-background p-4">
			<EntityEmailInbox {...props} class="h-full" onSendNew={() => undefined} />
		</div>
	{/snippet}
</Story>

<Story
	name="DraftGatedForMember"
	args={{
		messages: sampleEmailMessages,
		mailboxConnected: true,
		aiProviderConnected: false,
		smtpReady: false,
		role: 'member'
	}}
>
	{#snippet template(args)}
		{@const props =
			/** @type {import('$lib/components/crm/entity-email-inbox.svelte').EntityEmailInboxProps} */ (
				args
			)}
		<div class="h-screen bg-background p-4">
			<EntityEmailInbox {...props} class="h-full" />
		</div>
	{/snippet}
</Story>

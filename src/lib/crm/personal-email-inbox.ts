import type { ApiV1Client } from '$lib/api/v1/client.js';
import { isApiClientError } from '$lib/api/v1/errors.js';
import {
	toAiIntegrationResource,
	toEntityEmailMessage,
	toMailboxAccountResource
} from '$lib/api/v1/mappers.js';
import type {
	EmailMessage,
	EntityEmailEmptyState
} from '$lib/components/crm/entity-email-inbox.svelte';
import { hasConnectedAiProvider } from '$lib/schemas/integration.js';

export interface PersonalEmailInboxState {
	messages: EmailMessage[];
	emptyState: EntityEmailEmptyState;
	mailboxConnected: boolean;
	aiProviderConnected: boolean;
	smtpReady: boolean;
}

function resolveEmptyState(
	mailboxConnected: boolean,
	messageCount: number
): EntityEmailEmptyState {
	if (messageCount > 0) return 'no_matches';
	if (!mailboxConnected) return 'no_mailbox';
	return 'no_matches';
}

/**
 * Load personal working inbox: mailbox + AI + `GET /api/v1/me/email-messages`.
 * Soft-fails each source so the page still renders.
 */
export async function loadPersonalEmailInbox(
	api: ApiV1Client,
	signal?: AbortSignal
): Promise<PersonalEmailInboxState> {
	const [mailboxResult, integrationsResult, messagesResult] = await Promise.allSettled([
		api.mailbox.get(signal),
		api.integrations.list(signal),
		api.emailMessages.listMine({ limit: 50 }, signal)
	]);

	let mailboxConnected = false;
	let smtpReady = false;
	if (mailboxResult.status === 'fulfilled') {
		const resource = toMailboxAccountResource(mailboxResult.value);
		mailboxConnected = Boolean(resource?.credentials_configured);
		smtpReady = Boolean(
			resource?.credentials_configured && resource.smtp_host && resource.smtp_port
		);
	} else if (
		mailboxResult.reason &&
		isApiClientError(mailboxResult.reason) &&
		mailboxResult.reason.status === 404
	) {
		mailboxConnected = false;
	}

	let aiProviderConnected = false;
	if (integrationsResult.status === 'fulfilled') {
		aiProviderConnected = hasConnectedAiProvider(
			integrationsResult.value.map(toAiIntegrationResource)
		);
	}

	let messages: EmailMessage[] = [];
	if (messagesResult.status === 'fulfilled') {
		messages = messagesResult.value.map(toEntityEmailMessage);
	}

	return {
		messages,
		emptyState: resolveEmptyState(mailboxConnected, messages.length),
		mailboxConnected,
		aiProviderConnected,
		smtpReady
	};
}

export function emptyPersonalEmailInboxState(): PersonalEmailInboxState {
	return {
		messages: [],
		emptyState: 'no_mailbox',
		mailboxConnected: false,
		aiProviderConnected: false,
		smtpReady: false
	};
}

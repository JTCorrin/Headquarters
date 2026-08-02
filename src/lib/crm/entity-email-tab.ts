import type { ApiV1Client } from '$lib/api/v1/client.js';
import { isApiClientError } from '$lib/api/v1/errors.js';
import {
	toAiIntegrationResource,
	toEntityEmailMessage,
	toMailboxAccountResource
} from '$lib/api/v1/mappers.js';
import type { ApiEntityEmailType } from '$lib/api/v1/types.js';
import type {
	EmailMessage,
	EntityEmailEmptyState
} from '$lib/components/crm/entity-email-inbox.svelte';
import { hasConnectedAiProvider } from '$lib/schemas/integration.js';

export interface EntityEmailTabState {
	messages: EmailMessage[];
	emptyState: EntityEmailEmptyState;
	mailboxConnected: boolean;
	aiProviderConnected: boolean;
	smtpReady: boolean;
}

const emptyState: EntityEmailTabState = {
	messages: [],
	emptyState: 'no_mailbox',
	mailboxConnected: false,
	aiProviderConnected: false,
	smtpReady: false
};

function resolveEmptyState(
	mailboxConnected: boolean,
	messageCount: number
): EntityEmailEmptyState {
	if (messageCount > 0) return 'no_matches';
	if (!mailboxConnected) return 'no_mailbox';
	return 'no_matches';
}

/**
 * Load mailbox + AI + entity email list for a contact/lead/client Email tab.
 * Soft-fails mailbox/integrations/list independently so the profile still renders.
 */
export async function loadEntityEmailTab(
	api: ApiV1Client,
	entityType: ApiEntityEmailType,
	entityId: string,
	signal?: AbortSignal
): Promise<EntityEmailTabState> {
	const [mailboxResult, integrationsResult, messagesResult] = await Promise.allSettled([
		api.mailbox.get(signal),
		api.integrations.list(signal),
		api.emailMessages.listForEntity(entityType, entityId, signal)
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

export function emptyEntityEmailTabState(): EntityEmailTabState {
	return { ...emptyState };
}

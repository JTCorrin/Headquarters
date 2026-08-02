import { z } from 'zod';
import type { MembershipRole } from './organisation.js';
import { canMutateOrgConfig } from './organisation.js';

export const aiProviders = ['openai', 'anthropic', 'google', 'openrouter'] as const;
export type AiProvider = (typeof aiProviders)[number];

export const aiProviderLabels: Record<AiProvider, string> = {
	openai: 'OpenAI',
	anthropic: 'Anthropic',
	google: 'Google',
	openrouter: 'OpenRouter'
};

export const aiProviderHints: Record<AiProvider, string> = {
	openai: 'Paste an OpenAI API key. OAuth is not offered here.',
	anthropic: 'Paste an Anthropic API key. OAuth is not offered here.',
	google: 'Paste a Google AI API key for now. OAuth connect may land later.',
	openrouter: 'Paste an OpenRouter API key. OAuth is not offered here.'
};

export const aiProviderConnectSchema = z.object({
	apiKey: z.string().trim().min(1, 'API key is required').max(512)
});

export type AiProviderConnectData = z.infer<typeof aiProviderConnectSchema>;

export type AiIntegrationStatus = 'disconnected' | 'connected' | 'error';

export interface AiIntegrationResource {
	provider: AiProvider;
	/** True when a key is stored — never echo the key or secret_ref. */
	credentials_configured: boolean;
	status: AiIntegrationStatus;
	last_verified_at: string | null;
	last_error_code: string | null;
}

export function canMutateIntegrations(role: MembershipRole): boolean {
	return canMutateOrgConfig(role);
}

/** True when at least one AI provider is connected for Draft response. */
export function hasConnectedAiProvider(integrations: AiIntegrationResource[]): boolean {
	return integrations.some((item) => item.credentials_configured && item.status === 'connected');
}

export function draftResponseGateCopy(role: MembershipRole): {
	disabled: true;
	hint: string;
	href: string;
	linkLabel: string;
} {
	if (canMutateIntegrations(role)) {
		return {
			disabled: true,
			hint: 'Connect an AI provider in Org settings to draft replies.',
			href: '/org/integrations',
			linkLabel: 'Connect AI in Org settings'
		};
	}
	return {
		disabled: true,
		hint: 'Ask an Owner to connect AI before drafting replies.',
		href: '/settings',
		linkLabel: 'Ask an Owner to connect AI'
	};
}

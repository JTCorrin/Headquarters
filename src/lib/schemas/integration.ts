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

export const aiPromptKeys = [
	'email_reply',
	'meeting_summary',
	'meeting_task_proposals',
	'invoice_chase'
] as const;

export type AiPromptKey = (typeof aiPromptKeys)[number];

export const aiPromptLabels: Record<AiPromptKey, string> = {
	email_reply: 'Email reply',
	meeting_summary: 'Meeting summary',
	meeting_task_proposals: 'Meeting task proposals',
	invoice_chase: 'Invoice chase'
};

export const aiPromptHints: Record<AiPromptKey, string> = {
	email_reply:
		'Used by Draft response. Tone is injected at generate time as TONE: {warm|neutral|firm} — do not hardcode tone variants here.',
	meeting_summary: 'Used by Generate summary on the meeting workspace.',
	meeting_task_proposals: 'Used with Generate summary to propose follow-up tasks.',
	invoice_chase:
		'Used by Draft chase on invoices. Tone is injected as TONE: {polite|firm}.'
};

export const DEFAULT_AI_PROMPTS: Record<AiPromptKey, string> = {
	email_reply:
		'Draft a concise email reply based on the source message. Stay professional and actionable. Do not invent facts that are not in the thread.',
	meeting_summary:
		'Summarise this meeting transcript into clear prose: decisions, open questions, and next steps. Keep it skimmable.',
	meeting_task_proposals:
		'Extract 1–3 concrete follow-up tasks from the transcript. Each task needs a short title and a one-sentence description.',
	invoice_chase:
		'Draft a short payment-reminder email for this invoice. Be clear about the amount/due date when provided. Do not threaten legal action.'
};

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

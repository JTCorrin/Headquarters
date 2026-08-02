import type { ApiRequestFn } from '../request.js';
import type {
	ApiAiSuggestion,
	ApiAiSuggestionGenerateBody,
	ApiEmailMessage,
	ApiEmailMessageShareBody,
	ApiEmailMessageShareResult,
	ApiEntityEmailType
} from '../types.js';
import type { EmailMessagesEndpoints } from './types.js';

export function createEmailMessagesEndpoints(request: ApiRequestFn): EmailMessagesEndpoints {
	return {
		listForEntity: async (entityType: ApiEntityEmailType, entityId: string, signal) => {
			const plural =
				entityType === 'contact'
					? 'contacts'
					: entityType === 'lead'
						? 'leads'
						: 'clients';
			const { data } = await request<ApiEmailMessage[]>(
				`/api/v1/${plural}/${entityId}/email-messages`,
				{ orgScoped: true, signal }
			);
			return data;
		},
		share: async (messageId: string, body: ApiEmailMessageShareBody, signal) => {
			const { data } = await request<ApiEmailMessageShareResult>(
				`/api/v1/email-messages/${messageId}/share`,
				{ method: 'POST', body, orgScoped: true, signal }
			);
			return data;
		},
		generateDraft: async (body: ApiAiSuggestionGenerateBody, signal) => {
			const { data } = await request<ApiAiSuggestion>('/api/v1/ai-suggestions/email-reply', {
				method: 'POST',
				body,
				orgScoped: true,
				signal
			});
			return data;
		},
		useDraft: async (suggestionId: string, acceptedText, signal) => {
			const { data } = await request<ApiAiSuggestion>(
				`/api/v1/ai-suggestions/${suggestionId}/use`,
				{
					method: 'POST',
					body:
						acceptedText !== undefined ? { accepted_text: acceptedText ?? null } : undefined,
					orgScoped: true,
					signal
				}
			);
			return data;
		},
		discardDraft: async (suggestionId: string, signal) => {
			await request<null>(`/api/v1/ai-suggestions/${suggestionId}/discard`, {
				method: 'POST',
				orgScoped: true,
				signal
			});
		}
	};
}

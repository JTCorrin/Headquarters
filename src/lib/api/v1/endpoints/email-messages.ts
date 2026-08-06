import type { ApiRequestFn } from '../request.js';
import { newIdempotencyKey } from '../idempotency.js';
import type {
	ApiAiSuggestion,
	ApiAiSuggestionGenerateBody,
	ApiEmailMessage,
	ApiEmailMessageReplyBody,
	ApiEmailMessageShareBody,
	ApiEmailMessageShareResult,
	ApiEntityEmailType,
	ApiMyEmailMessageListParams
} from '../types.js';
import type { EmailMessagesEndpoints } from './types.js';

export function createEmailMessagesEndpoints(request: ApiRequestFn): EmailMessagesEndpoints {
	return {
		listMine: async (params: ApiMyEmailMessageListParams = {}, signal) => {
			const { data } = await request<ApiEmailMessage[]>('/api/v1/me/email-messages', {
				orgScoped: true,
				query: { limit: params.limit },
				signal
			});
			return data;
		},
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
		reply: async (messageId: string, body: ApiEmailMessageReplyBody, signal) => {
			const { data } = await request<ApiEmailMessage>(
				`/api/v1/email-messages/${messageId}/reply`,
				{
					method: 'POST',
					body,
					orgScoped: true,
					headers: { 'Idempotency-Key': newIdempotencyKey('email-reply') },
					signal
				}
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
		generateInvoiceChase: async (body, signal) => {
			const { data } = await request<ApiAiSuggestion>(
				'/api/v1/ai-suggestions/invoice-chase',
				{
					method: 'POST',
					body,
					orgScoped: true,
					signal
				}
			);
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

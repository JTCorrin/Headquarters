import type { ApiRequestFn } from '../request.js';
import type {
	ApiTimelineEntityType,
	ApiTimelineEvent,
	ApiTimelineEventCreateBody,
	ApiTimelineEventListParams
} from '../types.js';
import type { TimelineEventsEndpoints } from './types.js';

function entityTimelinePath(entityType: ApiTimelineEntityType, entityId: string): string {
	return `/api/v1/entities/${entityType}/${entityId}/timeline-events`;
}

export function createTimelineEventsEndpoints(request: ApiRequestFn): TimelineEventsEndpoints {
	async function listEntity(
		entityType: ApiTimelineEntityType,
		entityId: string,
		signal?: AbortSignal
	) {
		const { data } = await request<ApiTimelineEvent[]>(
			entityTimelinePath(entityType, entityId),
			{
				orgScoped: true,
				signal
			}
		);
		return data;
	}

	async function listOrg(params: ApiTimelineEventListParams = {}, signal?: AbortSignal) {
		return request<ApiTimelineEvent[]>('/api/v1/timeline-events', {
			orgScoped: true,
			query: {
				limit: params.limit,
				cursor: params.cursor
			},
			signal
		});
	}

	return {
		list: ((
			entityTypeOrParams?: ApiTimelineEntityType | ApiTimelineEventListParams,
			entityIdOrSignal?: string | AbortSignal,
			maybeSignal?: AbortSignal
		) => {
			if (typeof entityTypeOrParams === 'string') {
				return listEntity(entityTypeOrParams, entityIdOrSignal as string, maybeSignal);
			}
			return listOrg(
				entityTypeOrParams ?? {},
				entityIdOrSignal as AbortSignal | undefined
			);
		}) as TimelineEventsEndpoints['list'],
		create: async (entityType, entityId, body: ApiTimelineEventCreateBody, signal) => {
			const { data } = await request<ApiTimelineEvent>(
				entityTimelinePath(entityType, entityId),
				{
					method: 'POST',
					body,
					orgScoped: true,
					signal
				}
			);
			return data;
		}
	};
}

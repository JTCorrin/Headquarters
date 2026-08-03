import type { ApiRequestFn } from '../request.js';
import type {
	ApiTimelineEntityType,
	ApiTimelineEvent,
	ApiTimelineEventCreateBody
} from '../types.js';
import type { TimelineEventsEndpoints } from './types.js';

function entityTimelinePath(entityType: ApiTimelineEntityType, entityId: string): string {
	return `/api/v1/entities/${entityType}/${entityId}/timeline-events`;
}

export function createTimelineEventsEndpoints(request: ApiRequestFn): TimelineEventsEndpoints {
	return {
		list: async (entityType, entityId, signal) => {
			const { data } = await request<ApiTimelineEvent[]>(
				entityTimelinePath(entityType, entityId),
				{
					orgScoped: true,
					signal
				}
			);
			return data;
		},
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

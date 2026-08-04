import type { ApiRequestFn } from '../request.js';
import type {
	ApiNotificationListParams,
	ApiNotificationUnreadCount,
	ApiUserNotification
} from '../types.js';
import type { NotificationsEndpoints } from './types.js';

export function createNotificationsEndpoints(request: ApiRequestFn): NotificationsEndpoints {
	return {
		list: async (params: ApiNotificationListParams = {}, signal) => {
			return request<ApiUserNotification[]>('/api/v1/me/notifications', {
				orgScoped: true,
				query: {
					limit: params.limit,
					cursor: params.cursor
				},
				signal
			});
		},
		unreadCount: async (signal) => {
			const { data } = await request<ApiNotificationUnreadCount>(
				'/api/v1/me/notifications/unread-count',
				{ orgScoped: true, signal }
			);
			return data;
		},
		markRead: async (id, signal) => {
			const { data } = await request<ApiUserNotification>(
				`/api/v1/me/notifications/${id}`,
				{
					method: 'PATCH',
					body: { read: true },
					orgScoped: true,
					signal
				}
			);
			return data;
		}
	};
}

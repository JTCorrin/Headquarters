import { entityTimelineHref } from '$lib/api/v1/mappers.js';
import type { ApiUserNotification } from '$lib/api/v1/types.js';

function payloadString(payload: Record<string, unknown> | undefined, key: string): string | null {
	const value = payload?.[key];
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Resolve a bell-item click target from notification kind/source/payload. */
export function notificationDeepLink(row: ApiUserNotification): string | null {
	if (row.source_type === 'email_message' && row.source_id) {
		return `/email?message=${encodeURIComponent(row.source_id)}`;
	}

	if (row.kind === 'timeline.mention' || row.source_type === 'timeline_event') {
		const entityType = payloadString(row.payload, 'entity_type');
		const entityId = payloadString(row.payload, 'entity_id');
		const timelineEventId =
			payloadString(row.payload, 'timeline_event_id') ?? row.source_id ?? null;
		if (!entityType || !entityId) return null;
		return entityTimelineHref(entityType, entityId, timelineEventId ?? undefined) ?? null;
	}

	return null;
}

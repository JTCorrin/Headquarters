import type { ApiV1Client } from '$lib/api/v1/client.js';
import { isApiClientError } from '$lib/api/v1/errors.js';
import {
	toTimelineEvent,
	toTimelineEventCreateBody
} from '$lib/api/v1/mappers.js';
import type {
	ApiTimelineEntityType,
	ApiTimelineEventListParams
} from '$lib/api/v1/types.js';
import type { TimelineComposerSubmit } from '$lib/components/crm/timeline-composer.svelte';
import type { TimelineEvent } from '$lib/components/crm/timeline.svelte';

function softFailTimelineError(error: unknown): boolean {
	return (
		isApiClientError(error) &&
		(error.status === 404 ||
			error.code === 'NOT_FOUND' ||
			error.status === 501 ||
			error.isForbidden)
	);
}

/**
 * Load timeline cards for an entity profile rail.
 * Soft-fails to `[]` when the surface is missing or forbidden so the page still renders.
 */
export async function loadEntityTimeline(
	api: ApiV1Client,
	entityType: ApiTimelineEntityType,
	entityId: string,
	signal?: AbortSignal
): Promise<TimelineEvent[]> {
	try {
		const rows = await api.timelineEvents.list(entityType, entityId, signal);
		return rows.map(toTimelineEvent);
	} catch (error) {
		if (softFailTimelineError(error)) {
			return [];
		}
		throw error;
	}
}

/**
 * Load org-wide Home recent activity (`GET /api/v1/timeline-events`).
 * Soft-fails to `[]` when the surface is missing or forbidden.
 */
export async function loadOrgTimeline(
	api: ApiV1Client,
	params: ApiTimelineEventListParams = { limit: 50 },
	signal?: AbortSignal
): Promise<TimelineEvent[]> {
	try {
		const { data } = await api.timelineEvents.list(params, signal);
		return data.map(toTimelineEvent);
	} catch (error) {
		if (softFailTimelineError(error)) {
			return [];
		}
		throw error;
	}
}

/** POST a composer note and return the mapped card. */
export async function createEntityTimelineEvent(
	api: ApiV1Client,
	entityType: ApiTimelineEntityType,
	entityId: string,
	submit: TimelineComposerSubmit,
	signal?: AbortSignal
): Promise<TimelineEvent> {
	const row = await api.timelineEvents.create(
		entityType,
		entityId,
		toTimelineEventCreateBody(submit),
		signal
	);
	return toTimelineEvent(row);
}

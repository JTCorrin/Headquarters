import type { ApiMeetingRelatedEntityType, ApiTaskEntityType } from '$lib/api/v1/types.js';

const TASK_ENTITY_TYPES = new Set<ApiTaskEntityType>(['contact', 'lead', 'client', 'project']);
const MEETING_ENTITY_TYPES = new Set<ApiMeetingRelatedEntityType>([
	'client',
	'contact',
	'lead',
	'project'
]);

export interface EntityListFilter<T extends string> {
	entity_type: T;
	entity_id: string;
}

function looksLikeUuid(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
		value
	);
}

/**
 * Parse paired `entity_type` + `entity_id` query params.
 * Returns null unless both are present, type is allowed, and id looks like a UUID.
 */
export function parseEntityListFilter<T extends string>(
	searchParams: URLSearchParams | { get(name: string): string | null },
	allowed: ReadonlySet<T>
): EntityListFilter<T> | null {
	const entityType = searchParams.get('entity_type');
	const entityId = searchParams.get('entity_id');
	if (!entityType || !entityId) return null;
	if (!allowed.has(entityType as T)) return null;
	if (!looksLikeUuid(entityId)) return null;
	return { entity_type: entityType as T, entity_id: entityId };
}

export function parseTaskEntityFilter(
	searchParams: URLSearchParams | { get(name: string): string | null }
): EntityListFilter<ApiTaskEntityType> | null {
	return parseEntityListFilter(searchParams, TASK_ENTITY_TYPES);
}

export function parseMeetingEntityFilter(
	searchParams: URLSearchParams | { get(name: string): string | null }
): EntityListFilter<ApiMeetingRelatedEntityType> | null {
	return parseEntityListFilter(searchParams, MEETING_ENTITY_TYPES);
}

export function looksLikeVendorId(value: string | null | undefined): value is string {
	return typeof value === 'string' && looksLikeUuid(value);
}

/** Same UUID shape check — used for `/quotes?client_id=` preselect. */
export function looksLikeClientId(value: string | null | undefined): value is string {
	return typeof value === 'string' && looksLikeUuid(value);
}

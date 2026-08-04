import { getContext, setContext } from 'svelte';
import type { ApiV1Client } from './client.js';

const API_V1_CONTEXT = Symbol('hq.api-v1');

export function setApiV1Client(client: ApiV1Client): void {
	setContext(API_V1_CONTEXT, client);
}

export function getApiV1Client(): ApiV1Client {
	const client = getContext<ApiV1Client | undefined>(API_V1_CONTEXT);
	if (!client) {
		throw new Error('ApiV1Client is not provided in context');
	}
	return client;
}

/** Prefer for optional chrome (e.g. AppShell bell) — null when outside layout context. */
export function getOptionalApiV1Client(): ApiV1Client | null {
	return getContext<ApiV1Client | undefined>(API_V1_CONTEXT) ?? null;
}

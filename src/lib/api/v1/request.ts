import type { ApiListMeta } from './types.js';

export interface ApiRequestOptions {
	method?: string;
	body?: unknown;
	/** When true, requires and sends `X-Org-Id`. */
	orgScoped?: boolean;
	/** Optimistic concurrency token → `If-Match: "<version>"`. */
	ifMatchVersion?: number;
	headers?: HeadersInit;
	signal?: AbortSignal;
	/** Query string params encoded with URLSearchParams (undefined/null skipped). */
	query?: Record<string, string | number | boolean | null | undefined>;
}

export interface ApiResult<T> {
	data: T;
	meta?: ApiListMeta;
	etag: string | null;
	status: number;
}

export type ApiRequestFn = <T>(
	path: string,
	options?: ApiRequestOptions
) => Promise<ApiResult<T>>;

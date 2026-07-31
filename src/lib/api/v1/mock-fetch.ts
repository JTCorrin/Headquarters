import type { ApiErrorCode } from './errors.js';

export interface MockResponseInit {
	status?: number;
	body?: unknown;
	headers?: Record<string, string>;
}

export type MockHandler = (request: Request) => MockResponseInit | Promise<MockResponseInit>;

export function jsonResponse(init: MockResponseInit): Response {
	const status = init.status ?? 200;
	const headers = new Headers(init.headers);
	if (!headers.has('content-type') && status !== 204) {
		headers.set('content-type', 'application/json; charset=utf-8');
	}
	if (!headers.has('x-request-id')) {
		headers.set('x-request-id', 'test-request-id');
	}
	if (status === 204) {
		return new Response(null, { status, headers });
	}
	return new Response(JSON.stringify(init.body ?? null), { status, headers });
}

export function apiError(
	status: number,
	code: ApiErrorCode,
	message: string,
	fields?: Record<string, string>
): MockResponseInit {
	return {
		status,
		body: {
			error: {
				code,
				message,
				...(fields ? { fields } : {}),
				request_id: 'test-request-id'
			}
		}
	};
}

function resolveRequest(input: RequestInfo | URL, init?: RequestInit): Request {
	if (input instanceof Request) {
		const absolute = new URL(input.url, 'http://localhost');
		return new Request(absolute, input);
	}
	const absolute = new URL(typeof input === 'string' ? input : input.href, 'http://localhost');
	return new Request(absolute, init);
}

export function createMockFetch(handlers: Record<string, MockHandler>): typeof fetch {
	return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const request = resolveRequest(input, init);
		const url = new URL(request.url);
		const key = `${request.method.toUpperCase()} ${url.pathname}`;
		const handler = handlers[key] ?? handlers[`* ${url.pathname}`] ?? handlers['*'];
		if (!handler) {
			return jsonResponse(apiError(404, 'NOT_FOUND', `No mock for ${key}`));
		}
		return jsonResponse(await handler(request));
	};
}

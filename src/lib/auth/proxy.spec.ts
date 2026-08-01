import { describe, expect, it } from 'vitest';
import { buildApiV1ProxyUrl, forwardProxyHeaders, resolveApiV1Upstream } from './proxy.js';

describe('resolveApiV1Upstream', () => {
	it('prefers explicit API_V1_UPSTREAM', () => {
		expect(
			resolveApiV1Upstream({
				apiV1Upstream: 'http://edge.test/functions/v1/api-v1/',
				publicSupabaseUrl: 'http://ignored.test'
			})
		).toBe('http://edge.test/functions/v1/api-v1');
	});

	it('derives from PUBLIC_SUPABASE_URL', () => {
		expect(
			resolveApiV1Upstream({
				publicSupabaseUrl: 'http://192.168.5.136:54321/'
			})
		).toBe('http://192.168.5.136:54321/functions/v1/api-v1');
	});

	it('returns null when nothing is configured', () => {
		expect(resolveApiV1Upstream({})).toBeNull();
	});
});

describe('buildApiV1ProxyUrl', () => {
	it('strips /api/v1 so the browser never shows api-v1/api/v1', () => {
		expect(
			buildApiV1ProxyUrl(
				'http://192.168.5.136:54321/functions/v1/api-v1',
				'/api/v1/organisations',
				'?limit=10'
			)
		).toBe('http://192.168.5.136:54321/functions/v1/api-v1/organisations?limit=10');
	});

	it('handles the /api/v1 root', () => {
		expect(
			buildApiV1ProxyUrl('http://localhost:54321/functions/v1/api-v1', '/api/v1')
		).toBe('http://localhost:54321/functions/v1/api-v1/');
	});
});

describe('forwardProxyHeaders', () => {
	it('keeps auth and org headers, strips host/cookie', () => {
		const source = new Headers({
			authorization: 'Bearer tok',
			'x-org-id': 'org-1',
			'content-type': 'application/json',
			host: 'localhost:4173',
			cookie: 'sb=secret'
		});
		const forwarded = forwardProxyHeaders(source);
		expect(forwarded.get('authorization')).toBe('Bearer tok');
		expect(forwarded.get('x-org-id')).toBe('org-1');
		expect(forwarded.get('content-type')).toBe('application/json');
		expect(forwarded.get('host')).toBeNull();
		expect(forwarded.get('cookie')).toBeNull();
	});
});

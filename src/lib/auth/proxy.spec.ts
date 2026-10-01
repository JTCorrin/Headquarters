import { describe, expect, it } from 'vitest';
import {
	buildApiV1ProxyUrl,
	forwardProxyHeaders,
	forwardProxyResponseHeaders,
	resolveApiV1Upstream
} from './proxy.js';

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
				publicSupabaseUrl: 'http://10.0.0.136:54321/'
			})
		).toBe('http://10.0.0.136:54321/functions/v1/api-v1');
	});

	it('returns null when nothing is configured', () => {
		expect(resolveApiV1Upstream({})).toBeNull();
	});
});

describe('buildApiV1ProxyUrl', () => {
	it('strips /api/v1 so the browser never shows api-v1/api/v1', () => {
		expect(
			buildApiV1ProxyUrl(
				'http://10.0.0.136:54321/functions/v1/api-v1',
				'/api/v1/organisations',
				'?limit=10'
			)
		).toBe('http://10.0.0.136:54321/functions/v1/api-v1/organisations?limit=10');
	});

	it('handles the /api/v1 root', () => {
		expect(buildApiV1ProxyUrl('http://localhost:54321/functions/v1/api-v1', '/api/v1')).toBe(
			'http://localhost:54321/functions/v1/api-v1/'
		);
	});

	it('keeps other percent-encoded characters as sent', () => {
		expect(
			buildApiV1ProxyUrl('http://edge.test/functions/v1/api-v1', '/api/v1/contacts/a%40b')
		).toBe('http://edge.test/functions/v1/api-v1/contacts/a%40b');
	});

	it.each([
		'/api/v1/../../auth/v1/admin/users',
		'/api/v1/..%2F..%2Fauth/v1/admin',
		'/api/v1/%2e%2e/%2e%2e/rest/v1/contacts',
		'/api/v1/.%2E/x',
		'/api/v1/./contacts',
		'/api/v1/contacts%2F..%2F..',
		'/api/v1/contacts%5C..',
		'/api/v1/contacts%3Fapikey=x',
		'/api/v1/contacts%23frag',
		'/api/v1/%E0%A4%A'
	])('rejects %s so the request cannot escape the upstream base', (pathname) => {
		expect(buildApiV1ProxyUrl('http://edge.test/functions/v1/api-v1', pathname)).toBeNull();
	});
});

describe('forwardProxyResponseHeaders', () => {
	it('drops set-cookie, hop-by-hop and encoding headers', () => {
		const forwarded = forwardProxyResponseHeaders(
			new Headers({
				'content-type': 'application/json',
				'x-request-id': 'r1',
				'set-cookie': 'a=b',
				connection: 'keep-alive',
				'keep-alive': 'timeout=5',
				'content-encoding': 'gzip',
				'content-length': '10'
			})
		);
		expect(forwarded.get('content-type')).toBe('application/json');
		expect(forwarded.get('x-request-id')).toBe('r1');
		expect(forwarded.get('set-cookie')).toBeNull();
		expect(forwarded.get('connection')).toBeNull();
		expect(forwarded.get('keep-alive')).toBeNull();
		expect(forwarded.get('content-encoding')).toBeNull();
		expect(forwarded.get('content-length')).toBeNull();
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

	it('drops headers outside the allow-list (spoofable / unexpected)', () => {
		const source = new Headers({
			authorization: 'Bearer tok',
			'if-match': '"3"',
			'idempotency-key': 'abc',
			'x-forwarded-for': '1.2.3.4',
			'x-real-ip': '1.2.3.4',
			'x-custom': 'nope'
		});
		const forwarded = forwardProxyHeaders(source);
		expect(forwarded.get('if-match')).toBe('"3"');
		expect(forwarded.get('idempotency-key')).toBe('abc');
		expect(forwarded.get('x-forwarded-for')).toBeNull();
		expect(forwarded.get('x-real-ip')).toBeNull();
		expect(forwarded.get('x-custom')).toBeNull();
	});

	it('injects fallbackApikey when inbound apikey is missing', () => {
		const source = new Headers({
			authorization: 'Bearer crm_key_abc'
		});
		const forwarded = forwardProxyHeaders(source, {
			fallbackApikey: '  anon-public-key  '
		});
		expect(forwarded.get('apikey')).toBe('anon-public-key');
		expect(forwarded.get('authorization')).toBe('Bearer crm_key_abc');
	});

	it('does not overwrite an explicit inbound apikey', () => {
		const source = new Headers({
			authorization: 'Bearer crm_key_abc',
			apikey: 'client-supplied'
		});
		const forwarded = forwardProxyHeaders(source, {
			fallbackApikey: 'anon-public-key'
		});
		expect(forwarded.get('apikey')).toBe('client-supplied');
	});

	it('forwards mcp-* headers for Cursor / MCP sessions', () => {
		const source = new Headers({
			authorization: 'Bearer crm_key_abc',
			'mcp-session-id': 'sess-1'
		});
		const forwarded = forwardProxyHeaders(source, {
			fallbackApikey: 'anon-public-key'
		});
		expect(forwarded.get('mcp-session-id')).toBe('sess-1');
		expect(forwarded.get('apikey')).toBe('anon-public-key');
	});
});

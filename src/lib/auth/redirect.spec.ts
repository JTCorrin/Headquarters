import { describe, expect, it } from 'vitest';
import { authCallbackUrl, safeNextPath } from './redirect.js';

describe('auth redirects', () => {
	it('keeps same-origin relative destinations', () => {
		expect(safeNextPath('/invite/accept?token=abc')).toBe('/invite/accept?token=abc');
	});

	it('rejects protocol-relative and absolute destinations', () => {
		expect(safeNextPath('//evil.example/path')).toBe('/');
		expect(safeNextPath('https://evil.example/path')).toBe('/');
	});

	it('rejects paths that normalise to protocol-relative or cross-origin URLs', () => {
		expect(safeNextPath('/.//evil.example')).toBe('/');
		expect(safeNextPath('/..//evil.example/path')).toBe('/');
		expect(safeNextPath('/a/..//evil.example')).toBe('/');
		expect(safeNextPath('/%2e//evil.example')).toBe('/');
		expect(safeNextPath('/\\evil.example')).toBe('/');
		expect(safeNextPath('/\t/evil.example')).toBe('/');
	});

	it('builds a callback with a validated destination', () => {
		expect(authCallbackUrl('https://crm.example', '/select-org')).toBe(
			'https://crm.example/auth/callback?next=%2Fselect-org'
		);
	});
});

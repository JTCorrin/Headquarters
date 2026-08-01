import { describe, expect, it } from 'vitest';
import { resolveApiV1BaseUrl } from './base-url.js';

describe('resolveApiV1BaseUrl', () => {
	it('treats empty or whitespace as same-origin (undefined)', () => {
		expect(resolveApiV1BaseUrl(undefined)).toBeUndefined();
		expect(resolveApiV1BaseUrl('')).toBeUndefined();
		expect(resolveApiV1BaseUrl('   ')).toBeUndefined();
	});

	it('trims and strips trailing slashes for composition-root PUBLIC_API_BASE_URL', () => {
		expect(resolveApiV1BaseUrl(' https://api.example.test/ ')).toBe('https://api.example.test');
		expect(resolveApiV1BaseUrl('https://api.example.test///')).toBe('https://api.example.test');
	});
});

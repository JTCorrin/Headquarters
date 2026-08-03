import { describe, expect, it } from 'vitest';
import { sha256HexSync } from './sha256-hex.js';

describe('sha256HexSync', () => {
	it('matches known SHA-256 vectors', () => {
		expect(sha256HexSync(new TextEncoder().encode('hello'))).toBe(
			'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
		);
		expect(sha256HexSync(new TextEncoder().encode(''))).toBe(
			'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
		);
	});
});

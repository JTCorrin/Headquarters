import { describe, expect, it } from 'vitest';
import { newPlaybookNodeId } from './playbook-id.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newPlaybookNodeId', () => {
	it('returns a UUID-shaped id (secure or getRandomValues fallback)', () => {
		const id = newPlaybookNodeId();
		expect(id).toMatch(UUID_RE);
	});

	it('returns distinct ids', () => {
		const a = newPlaybookNodeId();
		const b = newPlaybookNodeId();
		expect(a).not.toBe(b);
	});
});

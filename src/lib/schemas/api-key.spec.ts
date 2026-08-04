import { describe, expect, it } from 'vitest';
import { apiKeyCreateSchema, apiKeyRoleOptions } from './api-key.js';

describe('api-key schema', () => {
	it('requires a non-empty name and known role', () => {
		expect(apiKeyCreateSchema.safeParse({ name: 'Agent', role: 'member' }).success).toBe(true);
		expect(apiKeyCreateSchema.safeParse({ name: '   ', role: 'member' }).success).toBe(false);
		expect(apiKeyCreateSchema.safeParse({ name: 'Agent', role: 'nope' }).success).toBe(false);
	});

	it('limits assignable roles to the actor ceiling', () => {
		expect(apiKeyRoleOptions('owner')).toContain('owner');
		expect(apiKeyRoleOptions('admin')).not.toContain('owner');
		expect(apiKeyRoleOptions('admin')).toContain('admin');
		expect(apiKeyRoleOptions('admin')).toContain('member');
	});
});

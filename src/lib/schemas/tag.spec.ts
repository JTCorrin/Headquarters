import { describe, expect, it } from 'vitest';
import { tagFormSchema } from './tag.js';

describe('tagFormSchema', () => {
	it('accepts a valid name and optional color', () => {
		expect(tagFormSchema.parse({ name: 'Newsletter', color: 'blue' })).toEqual({
			name: 'Newsletter',
			color: 'blue'
		});
		expect(tagFormSchema.parse({ name: 'Partners', color: '' })).toEqual({
			name: 'Partners',
			color: ''
		});
	});

	it('rejects empty or overlong names', () => {
		expect(tagFormSchema.safeParse({ name: '' }).success).toBe(false);
		expect(tagFormSchema.safeParse({ name: 'x'.repeat(81) }).success).toBe(false);
	});
});

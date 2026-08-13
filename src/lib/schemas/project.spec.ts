import { describe, expect, it } from 'vitest';
import {
	INTERNAL_PROJECT_CLIENT_ID,
	projectClientDisplayName,
	projectFormSchema
} from './project.js';

describe('projectFormSchema', () => {
	it('accepts Internal or a client UUID', () => {
		expect(
			projectFormSchema.safeParse({
				name: 'Ops handbook',
				clientId: INTERNAL_PROJECT_CLIENT_ID,
				description: '',
				status: 'planning'
			}).success
		).toBe(true);
		expect(
			projectFormSchema.safeParse({
				name: 'Client rollout',
				clientId: 'cccccccc-cccc-4ddd-8eee-ffffffffffff',
				description: '',
				status: 'active'
			}).success
		).toBe(true);
		expect(
			projectFormSchema.safeParse({
				name: 'Ops handbook',
				clientId: '',
				description: '',
				status: 'planning'
			}).success
		).toBe(false);
	});
});

describe('projectClientDisplayName', () => {
	it('labels unattached projects as Internal', () => {
		expect(projectClientDisplayName({ client_id: null })).toBe('Internal');
		expect(
			projectClientDisplayName({
				client_id: 'cccccccc-cccc-4ddd-8eee-ffffffffffff',
				client_label: 'Northwind'
			})
		).toBe('Northwind');
	});
});

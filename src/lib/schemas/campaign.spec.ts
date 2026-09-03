import { describe, expect, it } from 'vitest';
import { campaignFormSchema } from './campaign.js';

const TEMPLATE_ID = '11111111-2222-4333-8444-555555555555';
const MAILBOX_ID = '22222222-3333-4444-8555-666666666666';
const TAG_ID = '33333333-4444-4555-8666-777777777777';

describe('campaignFormSchema', () => {
	it('requires name, template, mailbox, and at least one entity type', () => {
		const parsed = campaignFormSchema.parse({
			name: 'Spring Shot',
			template_id: TEMPLATE_ID,
			mailbox_id: MAILBOX_ID,
			tag_ids: [TAG_ID],
			entity_types: ['lead', 'contact'],
			scheduled_at: ''
		});
		expect(parsed.entity_types).toEqual(['lead', 'contact']);
		expect(parsed.tag_ids).toEqual([TAG_ID]);
	});

	it('rejects missing audience entity types', () => {
		expect(
			campaignFormSchema.safeParse({
				name: 'Spring Shot',
				template_id: TEMPLATE_ID,
				mailbox_id: MAILBOX_ID,
				tag_ids: [],
				entity_types: []
			}).success
		).toBe(false);
	});

	it('rejects invalid uuids for template and mailbox', () => {
		expect(
			campaignFormSchema.safeParse({
				name: 'X',
				template_id: 'not-a-uuid',
				mailbox_id: MAILBOX_ID,
				entity_types: ['contact']
			}).success
		).toBe(false);
	});
});

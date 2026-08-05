import { describe, expect, it } from 'vitest';
import {
	attentionLineFromRecipients,
	billingContactIdFromRecipients,
	chaseGreetingName,
	documentRecipientsFieldSchema
} from './document-recipients.js';

describe('document recipients helpers', () => {
	const options = [
		{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', label: 'Ada Billing', clientId: null },
		{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', label: 'Bob Ops', clientId: null }
	];

	it('allows empty recipients and requires one billing when non-empty', () => {
		expect(documentRecipientsFieldSchema.safeParse([]).success).toBe(true);
		expect(
			documentRecipientsFieldSchema.safeParse([
				{ contactId: options[0].id, isBilling: true },
				{ contactId: options[1].id, isBilling: false }
			]).success
		).toBe(true);
		expect(
			documentRecipientsFieldSchema.safeParse([
				{ contactId: options[0].id, isBilling: true },
				{ contactId: options[1].id, isBilling: true }
			]).success
		).toBe(false);
	});

	it('builds Attn from billing then others', () => {
		expect(
			attentionLineFromRecipients(
				[
					{ contactId: options[0].id, isBilling: true },
					{ contactId: options[1].id, isBilling: false }
				],
				options
			)
		).toBe('Attn: Ada Billing; Bob Ops');
	});

	it('prefers billing contact for chase greeting', () => {
		expect(
			chaseGreetingName(
				[{ contactId: options[0].id, isBilling: true }],
				options,
				'Northwind'
			)
		).toBe('Ada Billing');
		expect(chaseGreetingName([], options, 'Northwind')).toBe('Northwind');
		expect(billingContactIdFromRecipients([])).toBeNull();
	});
});

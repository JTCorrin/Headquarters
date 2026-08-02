import { describe, expect, it, afterEach } from 'vitest';
import {
	clearMailboxDraft,
	getMailboxDraft,
	mailboxFormHasUserInput,
	resetMailboxDraftsForTests,
	setMailboxDraft,
	shouldRetainMailboxDraft
} from './mailbox-draft.js';
import { emptyMailboxFormData } from '$lib/schemas/mailbox.js';

const ORG = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

afterEach(() => {
	resetMailboxDraftsForTests();
});

describe('mailbox draft retention', () => {
	it('stores and retrieves a draft per org', () => {
		const draft = {
			...emptyMailboxFormData('custom'),
			emailAddress: 'joe@acme.test',
			username: 'joe@acme.test'
		};
		setMailboxDraft(ORG, draft);
		expect(getMailboxDraft(ORG)?.emailAddress).toBe('joe@acme.test');
		clearMailboxDraft(ORG);
		expect(getMailboxDraft(ORG)).toBeUndefined();
	});

	it('detects user input in an otherwise empty custom preset', () => {
		expect(mailboxFormHasUserInput(emptyMailboxFormData('custom'))).toBe(false);
		expect(
			mailboxFormHasUserInput({
				...emptyMailboxFormData('custom'),
				emailAddress: 'joe@acme.test'
			})
		).toBe(true);
	});

	it('retains draft when no saved mailbox exists', () => {
		setMailboxDraft(ORG, {
			...emptyMailboxFormData('custom'),
			emailAddress: 'draft@acme.test',
			username: 'draft-user'
		});
		expect(shouldRetainMailboxDraft(ORG, null)).toBe(true);
	});
});

import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import DocumentRecipientsFieldTestHost from './document-recipients-field.test-host.svelte';

const CLIENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLIENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONTACT_A = '11111111-1111-4111-8111-aaaaaaaaaaaa';
const CONTACT_B = '22222222-2222-4222-8222-bbbbbbbbbbbb';
const CONTACT_UNLINKED = '33333333-3333-4333-8333-cccccccccccc';

const contactOptions = [
	{ id: CONTACT_A, label: 'Ada Linked A', clientId: CLIENT_A },
	{ id: CONTACT_B, label: 'Bob Linked B', clientId: CLIENT_B },
	{ id: CONTACT_UNLINKED, label: 'Chris Unlinked', clientId: null }
];

describe('DocumentRecipientsField client filter', () => {
	it('only lists contacts for the selected client', async () => {
		render(DocumentRecipientsFieldTestHost, {
			clientId: CLIENT_A,
			contactOptions,
			recipients: []
		});

		await page.getByTestId('document-recipients-add').click();
		await expect.element(page.getByText('Ada Linked A')).toBeInTheDocument();
		await expect.element(page.getByText('Bob Linked B')).not.toBeInTheDocument();
		await expect.element(page.getByText('Chris Unlinked')).not.toBeInTheDocument();
	});

	it('shows empty-state when the client has no linked contacts', async () => {
		render(DocumentRecipientsFieldTestHost, {
			clientId: CLIENT_A,
			contactOptions: [{ id: CONTACT_B, label: 'Bob Linked B', clientId: CLIENT_B }],
			recipients: []
		});

		await expect.element(page.getByTestId('document-recipients-empty-client')).toBeInTheDocument();
	});

	it('asks for a client before adding recipients', async () => {
		render(DocumentRecipientsFieldTestHost, {
			clientId: '',
			contactOptions,
			recipients: []
		});

		await expect.element(page.getByTestId('document-recipients-need-client')).toBeInTheDocument();
	});
});

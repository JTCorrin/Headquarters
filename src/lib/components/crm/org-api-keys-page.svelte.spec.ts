import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import OrgApiKeysPage from './org-api-keys-page.svelte';
import { navGroupsWithActive } from '../../../stories/crm/story-fixtures.js';
import type { ApiOrgApiKey } from '$lib/api/v1/types.js';

const KEY_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const keys: ApiOrgApiKey[] = [
	{
		id: KEY_ID,
		org_id: '11111111-2222-4333-8444-555555555555',
		name: 'Buzz agent',
		prefix: 'crm_key_a1b2c3d4',
		role: 'member',
		scopes: [],
		expires_at: null,
		last_used_at: null,
		revoked_at: null,
		created_at: '2026-08-04T12:00:00.000Z',
		created_by: null
	}
];

describe('OrgApiKeysPage', () => {
	it('lists keys and opens create drawer', async () => {
		render(OrgApiKeysPage, {
			orgName: 'Corrin Data',
			navGroups: navGroupsWithActive('API keys'),
			role: 'owner',
			keys
		});

		await expect.element(page.getByTestId(`org-api-keys-row-${KEY_ID}`)).toBeInTheDocument();
		await expect.element(page.getByText('crm_key_a1b2c3d4…')).toBeInTheDocument();
		await expect.element(page.getByText('Member')).toBeInTheDocument();

		await page.getByTestId('org-api-keys-create').click();
		await expect.element(page.getByTestId('org-api-keys-create-drawer')).toBeInTheDocument();
		await expect.element(page.getByTestId('org-api-keys-create-form')).toBeInTheDocument();
	});

	it('shows empty copy when there are no keys', async () => {
		render(OrgApiKeysPage, {
			orgName: 'Corrin Data',
			navGroups: navGroupsWithActive('API keys'),
			role: 'admin',
			keys: []
		});

		await expect.element(page.getByTestId('org-api-keys-empty')).toBeInTheDocument();
	});

	it('reveals secret once in the create drawer', async () => {
		render(OrgApiKeysPage, {
			orgName: 'Corrin Data',
			navGroups: navGroupsWithActive('API keys'),
			role: 'owner',
			keys,
			revealedSecret: 'crm_key_' + 'ab'.repeat(16)
		});

		await page.getByTestId('org-api-keys-create').click();
		await expect.element(page.getByTestId('org-api-keys-secret-reveal')).toBeInTheDocument();
		await expect
			.element(page.getByTestId('org-api-keys-secret-value'))
			.toHaveTextContent(/^crm_key_[0-9a-f]{32}$/);
	});

	it('confirms before revoking a key', async () => {
		const onRevoke = vi.fn(async () => true);
		const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

		render(OrgApiKeysPage, {
			orgName: 'Corrin Data',
			navGroups: navGroupsWithActive('API keys'),
			role: 'owner',
			keys,
			onRevoke
		});

		await page.getByTestId(`org-api-keys-revoke-${KEY_ID}`).click();
		expect(confirmSpy).toHaveBeenCalled();
		expect(onRevoke).toHaveBeenCalledWith(KEY_ID);

		confirmSpy.mockRestore();
	});
});

import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import ContactProfilePage from './contact-profile-page.svelte';
import { navGroupsWithActive } from '../../../stories/crm/story-fixtures.js';

describe('ContactProfilePage tabs', () => {
	it('does not expose a Money tab', async () => {
		render(ContactProfilePage, {
			orgName: 'Corrin Data',
			navGroups: navGroupsWithActive('Contacts'),
			breadcrumb: 'Contacts / Ava Chen',
			title: 'Ava Chen',
			status: 'Active',
			contactFields: [{ label: 'Email', value: 'ava@northwind.com' }],
			companyFields: [{ label: 'Company', value: 'Northwind' }],
			showNav: false
		});

		await expect.element(page.getByRole('tab', { name: 'Details' })).toBeInTheDocument();
		await expect.element(page.getByRole('tab', { name: 'Email' })).toBeInTheDocument();
		await expect.element(page.getByRole('tab', { name: 'Documents' })).toBeInTheDocument();
		await expect.element(page.getByRole('tab', { name: 'Money' })).not.toBeInTheDocument();
	});
});

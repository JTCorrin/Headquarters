import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import ContactProfileEditTestHost from './contact-profile-edit.test-host.svelte';
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

	it('opens the edit drawer when Edit is clicked', async () => {
		render(ContactProfileEditTestHost, {
			orgName: 'Corrin Data',
			navGroups: navGroupsWithActive('Contacts')
		});

		await page.getByTestId('contact-edit').click();
		await expect.element(page.getByText('Edit contact')).toBeInTheDocument();
		await expect.element(page.getByLabelText('Name')).toHaveValue('Ava Chen');
	});

	it('shows Delete when onDelete is provided', async () => {
		render(ContactProfilePage, {
			orgName: 'Corrin Data',
			navGroups: navGroupsWithActive('Contacts'),
			breadcrumb: 'Contacts / Ava Chen',
			title: 'Ava Chen',
			status: 'Active',
			contactFields: [{ label: 'Email', value: 'ava@northwind.com' }],
			companyFields: [{ label: 'Company', value: 'Northwind' }],
			showNav: false,
			onDelete: () => undefined
		});

		await expect.element(page.getByTestId('contact-delete')).toBeInTheDocument();
	});
});

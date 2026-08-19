import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import ClientProfilePage from './client-profile-page.svelte';
import { navGroupsWithActive } from '../../../stories/crm/story-fixtures.js';

const CLIENT_ID = 'cccccccc-cccc-4ddd-8eee-ffffffffffff';

describe('ClientProfilePage actions', () => {
	it('switches to the Email tab from the header Email button', async () => {
		render(ClientProfilePage, {
			orgName: 'Corrin Data',
			navGroups: navGroupsWithActive('Clients'),
			breadcrumb: 'Clients',
			title: 'Northwind',
			status: 'Active',
			companyFields: [{ label: 'Industry', value: 'Logistics' }],
			clientId: CLIENT_ID,
			showNav: false
		});

		await expect
			.element(page.getByRole('tab', { name: 'Details' }))
			.toHaveAttribute('data-state', 'active');

		await page.getByTestId('client-email-action').click();

		await expect
			.element(page.getByRole('tab', { name: 'Email' }))
			.toHaveAttribute('data-state', 'active');
		await expect.element(page.getByTestId('email-compose-to')).toBeInTheDocument();
	});

	it('links New quote to quotes create with this client preselected', async () => {
		render(ClientProfilePage, {
			orgName: 'Corrin Data',
			navGroups: navGroupsWithActive('Clients'),
			breadcrumb: 'Clients',
			title: 'Northwind',
			status: 'Active',
			companyFields: [{ label: 'Industry', value: 'Logistics' }],
			clientId: CLIENT_ID,
			showNav: false
		});

		const link = page.getByTestId('client-new-quote-action');
		await expect.element(link).toHaveAttribute('href', `/quotes?client_id=${CLIENT_ID}&new=1`);
	});

	it('links related contacts from the Details tab', async () => {
		const CONTACT_ID = '22222222-3333-4444-8555-666666666666';
		render(ClientProfilePage, {
			orgName: 'Corrin Data',
			navGroups: navGroupsWithActive('Clients'),
			breadcrumb: 'Clients',
			title: 'Northwind',
			status: 'Active',
			companyFields: [{ label: 'Industry', value: 'Logistics' }],
			clientId: CLIENT_ID,
			relatedContacts: [
				{
					id: CONTACT_ID,
					name: 'Ava Chen',
					role: 'Primary',
					email: 'ava@northwind.com'
				}
			],
			showNav: false
		});

		const link = page.getByRole('link', { name: 'Ava Chen' });
		await expect.element(link).toHaveAttribute('href', `/contacts/${CONTACT_ID}`);
		await expect.element(page.getByText('ava@northwind.com')).toBeInTheDocument();
	});
});

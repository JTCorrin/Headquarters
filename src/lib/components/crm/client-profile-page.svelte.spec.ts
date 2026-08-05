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

		await expect.element(page.getByRole('tab', { name: 'Details' })).toHaveAttribute(
			'data-state',
			'active'
		);

		await page.getByTestId('client-email-action').click();

		await expect.element(page.getByRole('tab', { name: 'Email' })).toHaveAttribute(
			'data-state',
			'active'
		);
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
		await expect.element(link).toHaveAttribute(
			'href',
			`/quotes?client_id=${CLIENT_ID}&new=1`
		);
	});

	it('invokes onNewQuote when provided instead of using href', async () => {
		const onNewQuote = vi.fn();
		render(ClientProfilePage, {
			orgName: 'Corrin Data',
			navGroups: navGroupsWithActive('Clients'),
			breadcrumb: 'Clients',
			title: 'Northwind',
			status: 'Active',
			companyFields: [{ label: 'Industry', value: 'Logistics' }],
			clientId: CLIENT_ID,
			onNewQuote,
			showNav: false
		});

		await page.getByTestId('client-new-quote-action').click();
		expect(onNewQuote).toHaveBeenCalledOnce();
	});
});

import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import SettingsConfigPageTestHost from './settings-config-page.test-host.svelte';
import type {
	OrganisationConfigResource,
	TaxRateResource
} from '$lib/schemas/organisation.js';
import { navGroupsWithActive } from '../../../stories/crm/story-fixtures.js';

const configuration: OrganisationConfigResource = {
	id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
	version: 2,
	name: 'Corrin Data',
	slug: 'corrin-data',
	timezone: 'Europe/London',
	default_currency: 'GBP',
	locale: 'en-GB',
	country_code: 'GB',
	theme_default: 'system'
};

const taxRates: TaxRateResource[] = [
	{
		id: 'tax-1',
		version: 1,
		name: 'VAT 20%',
		rate_percent: 20,
		is_default: true,
		active: true
	},
	{
		id: 'tax-2',
		version: 1,
		name: 'Zero rated',
		rate_percent: 0,
		is_default: false,
		active: true
	}
];

describe('SettingsConfigPage', () => {
	it('recovers from 412 conflict via reload', async () => {
		const onReload = vi.fn();
		render(SettingsConfigPageTestHost, {
			orgName: 'Corrin Data',
			navGroups: navGroupsWithActive('Config'),
			role: 'owner',
			configuration,
			taxRates,
			viewState: {
				kind: 'conflict',
				message: 'Organisation version does not match If-Match'
			},
			onReload
		});

		await expect.element(page.getByText(/412/i)).toBeInTheDocument();
		await page.getByRole('button', { name: 'Reload' }).click();
		expect(onReload).toHaveBeenCalled();
	});

	it('sets a single default tax rate via callback', async () => {
		const onSetDefaultTaxRate = vi.fn();
		render(SettingsConfigPageTestHost, {
			orgName: 'Corrin Data',
			navGroups: navGroupsWithActive('Config'),
			role: 'admin',
			configuration,
			taxRates,
			onSetDefaultTaxRate
		});

		await page.getByTestId('tax-rate-set-default-tax-2').click();
		expect(onSetDefaultTaxRate).toHaveBeenCalledWith('tax-2');
		await expect
			.element(page.getByTestId('tax-rate-row-tax-2'))
			.toHaveTextContent(/Default/i);
	});

	it('keeps tax mutation controls hidden for readonly roles', async () => {
		render(SettingsConfigPageTestHost, {
			orgName: 'Corrin Data',
			navGroups: navGroupsWithActive('Config'),
			role: 'readonly',
			configuration,
			taxRates
		});

		await expect.element(page.getByTestId('tax-rates-list')).toBeInTheDocument();
		expect(page.getByTestId('tax-rate-add').elements().length).toBe(0);
		expect(page.getByTestId('tax-rate-set-default-tax-2').elements().length).toBe(0);
	});

	it('does not offer Archive on the active default tax rate', async () => {
		render(SettingsConfigPageTestHost, {
			orgName: 'Corrin Data',
			navGroups: navGroupsWithActive('Config'),
			role: 'owner',
			configuration,
			taxRates
		});

		expect(page.getByTestId('tax-rate-archive-tax-1').elements().length).toBe(0);
		await expect.element(page.getByTestId('tax-rate-archive-tax-2')).toBeInTheDocument();
	});
});

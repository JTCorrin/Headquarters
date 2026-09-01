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
	legal_name: null,
	slug: 'corrin-data',
	logo_path: null,
	logo_url: null,
	billing_email: null,
	phone: null,
	website_url: null,
	tax_identifier: null,
	registration_number: null,
	address_line1: null,
	address_line2: null,
	city: null,
	region: null,
	postal_code: null,
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
	it('can still host personal Mail when mailboxForm is provided', async () => {
		render(SettingsConfigPageTestHost, {
			orgName: 'Corrin Data',
			navGroups: navGroupsWithActive('Config'),
			role: 'owner',
			configuration,
			taxRates,
			includeMailbox: true,
			mailboxAccount: {
				id: 'mb-1',
				email_address: 'joe@acme.test',
				username: 'joe@acme.test',
				from_name: 'Joe',
				imap_host: 'imap.example.test',
				imap_port: 993,
				imap_security: 'tls',
				smtp_host: 'smtp.example.test',
				smtp_port: 465,
				smtp_security: 'tls',
				credentials_configured: true,
				status: 'configured',
				auth_mode: 'password',
				oauth_provider: null,
				last_checked_at: null,
				last_error_code: null,
				syncIntervalMinutes: 10
			}
		});

		await expect.element(page.getByTestId('personal-mail-section')).toBeInTheDocument();
		await expect
			.element(page.getByText(/not the org Email sending/i))
			.toBeInTheDocument();
		await expect.element(page.getByTestId('profile-mailbox-form')).toBeInTheDocument();
		expect(page.getByTestId('mailbox-sync-interval').elements().length).toBe(0);
	});

	it('omits personal Mail on Owner org Config when mailboxForm is absent', async () => {
		render(SettingsConfigPageTestHost, {
			orgName: 'Corrin Data',
			navGroups: navGroupsWithActive('Config'),
			role: 'owner',
			configuration,
			taxRates,
			includeMailbox: false
		});

		expect(page.getByTestId('personal-mail-section').elements().length).toBe(0);
		await expect.element(page.getByTestId('organisation-config-form')).toBeInTheDocument();
	});

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
			role: 'owner',
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

	it('keeps tax mutation controls hidden for admin roles', async () => {
		render(SettingsConfigPageTestHost, {
			orgName: 'Corrin Data',
			navGroups: navGroupsWithActive('Config'),
			role: 'admin',
			configuration,
			taxRates
		});

		await expect.element(page.getByTestId('tax-rates-list')).toBeInTheDocument();
		expect(page.getByTestId('tax-rate-add').elements().length).toBe(0);
		expect(page.getByTestId('tax-rate-set-default-tax-2').elements().length).toBe(0);
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

	it('keeps the tax drawer open on delayed save failure', async () => {
		let releaseSave!: () => void;
		const saveGate = new Promise<void>((resolve) => {
			releaseSave = resolve;
		});
		const onSaveTaxRate = vi.fn(async () => {
			await saveGate;
			return false;
		});

		render(SettingsConfigPageTestHost, {
			orgName: 'Corrin Data',
			navGroups: navGroupsWithActive('Config'),
			role: 'owner',
			configuration,
			taxRates,
			onSaveTaxRate
		});

		await page.getByTestId('tax-rate-add').click();
		await expect.element(page.getByTestId('tax-rate-drawer')).toBeInTheDocument();
		await page.getByTestId('tax-rate-drawer').getByLabelText('Name').fill('Reduced 5%');
		const submit = page.getByTestId('tax-rate-submit');
		await submit.click();

		await expect.element(submit).toHaveTextContent(/Saving/i);
		await expect.element(submit).toBeDisabled();
		await submit.click({ force: true }).catch(() => undefined);
		expect(onSaveTaxRate).toHaveBeenCalledTimes(1);

		releaseSave();
		await expect.element(page.getByTestId('tax-rate-save-error')).toBeInTheDocument();
		await expect.element(page.getByTestId('tax-rate-drawer')).toBeInTheDocument();
		await expect.element(submit).not.toBeDisabled();
	});
});

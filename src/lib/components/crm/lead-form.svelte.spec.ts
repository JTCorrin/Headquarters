import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import LeadFormTestHost from './lead-form.test-host.svelte';

describe('LeadForm', () => {
	it('labels value as ordinary currency, not cents', async () => {
		render(LeadFormTestHost);
		await expect.element(page.getByLabelText('Value')).toBeInTheDocument();
		await expect.element(page.getByText(/\(cents\)/i)).not.toBeInTheDocument();
	});

	it('shows lost reason when stage is lost', async () => {
		render(LeadFormTestHost, { initial: { stage: 'lost' } });
		await expect.element(page.getByLabelText('Lost reason')).toBeInTheDocument();
	});

	it('surfaces validation when name is missing on submit', async () => {
		render(LeadFormTestHost, { initial: { name: '' } });
		await page.getByRole('button', { name: 'Save lead' }).click();
		await expect.element(page.getByText(/name is required/i)).toBeInTheDocument();
	});

	it('surfaces lost reason required when marking lost without reason', async () => {
		render(LeadFormTestHost, {
			initial: { name: 'Deal', stage: 'lost', lostReason: '' }
		});
		await page.getByRole('button', { name: 'Save lead' }).click();
		await expect.element(page.getByText(/required when stage is lost/i)).toBeInTheDocument();
	});
});

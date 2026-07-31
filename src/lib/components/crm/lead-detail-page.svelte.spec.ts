import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import LeadDetailTestHost from './lead-detail.test-host.svelte';

const lead = {
	id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
	version: 3,
	name: 'Contoso expansion',
	company_name: 'Contoso',
	stage: 'proposal' as const,
	value_cents: 1_800_000,
	currency: 'GBP'
};

describe('LeadDetailPage', () => {
	it('opens convert dialog and confirms conversion callback', async () => {
		const onConvert = vi.fn();
		render(LeadDetailTestHost, { lead, onConvert });

		await page.getByTestId('open-convert').click();
		await expect.element(page.getByTestId('convert-lead-dialog')).toBeInTheDocument();
		await page.getByTestId('convert-confirm').click();
		expect(onConvert).toHaveBeenCalled();
	});

	it('shows conflict recovery control for 412', async () => {
		const onReload = vi.fn();
		render(LeadDetailTestHost, {
			lead,
			viewState: { kind: 'conflict', message: 'Lead version does not match If-Match' },
			onReload
		});

		await expect.element(page.getByText(/412/i)).toBeInTheDocument();
		await page.getByRole('button', { name: 'Reload' }).click();
		expect(onReload).toHaveBeenCalled();
	});

	it('shows idempotent convert result banner', async () => {
		render(LeadDetailTestHost, {
			lead: {
				...lead,
				stage: 'won',
				client_id: '11111111-2222-4333-8444-555555555555',
				converted_at: '2026-07-30T12:00:00Z'
			},
			lastConvertResult: {
				lead: {
					...lead,
					stage: 'won',
					client_id: '11111111-2222-4333-8444-555555555555'
				},
				client: {
					id: '11111111-2222-4333-8444-555555555555',
					version: 1,
					name: 'Contoso',
					status: 'active'
				},
				idempotent: true
			}
		});

		await expect
			.element(page.getByTestId('convert-result'))
			.toHaveTextContent(/already converted/i);
	});
});

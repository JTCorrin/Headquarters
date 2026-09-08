import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { ApiCampaign } from '$lib/api/v1/types.js';
import CampaignDetailPage from './campaign-detail-page.svelte';

function campaign(status: ApiCampaign['status'] = 'completed'): ApiCampaign {
	return {
		id: 'campaign',
		org_id: 'org',
		name: 'Product launch',
		status,
		created_at: '2026-01-01T10:00:00Z',
		updated_at: '2026-01-01T10:00:00Z',
		created_by: null,
		updated_by: null,
		deleted_at: null,
		version: 1,
		template_id: null,
		mailbox_id: null,
		scheduled_at: '2026-01-01T10:00:00Z',
		started_at: '2026-01-01T10:00:00Z',
		completed_at: null,
		last_error: null,
		tag_ids: [],
		entity_types: ['contact'],
		recipient_counts: { pending: 2, sent: 0, failed: 0, skipped: 0, total: 2 },
		quota_remaining: 100
	};
}

describe('campaign progress and resend', () => {
	it('requires an explicit confirmation before preparing another draft', async () => {
		const resend = vi.fn();
		render(CampaignDetailPage, {
			orgName: 'Test',
			navGroups: [],
			showNav: false,
			campaign: campaign(),
			recipients: [],
			onResend: resend
		});
		await page.getByRole('button', { name: 'Resend campaign' }).click();
		expect(resend).not.toHaveBeenCalled();
		await expect
			.element(page.getByText(/Previously contacted people may\s+be included/))
			.toBeVisible();
		await page.getByRole('button', { name: 'Create resend draft' }).click();
		expect(resend).toHaveBeenCalledOnce();
	});
	it('shows stalled sending and activity without offering resend for an active campaign', async () => {
		render(CampaignDetailPage, {
			orgName: 'Test',
			navGroups: [],
			showNav: false,
			campaign: campaign('sending'),
			recipients: [],
			onResend: vi.fn(),
			activity: [
				{
					id: 'event',
					created_at: '2026-01-01T10:00:00Z',
					level: 'warning',
					message: 'Sending allowance reached.'
				}
			]
		});
		await expect.element(page.getByText(/Sending appears delayed/)).toBeVisible();
		await expect.element(page.getByText('Sending allowance reached.')).toBeVisible();
		await expect
			.element(page.getByRole('button', { name: 'Resend campaign' }))
			.not.toBeInTheDocument();
	});
});

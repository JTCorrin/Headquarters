import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { createMockFetch } from '$lib/api/v1/mock-fetch.js';
import { createOrgSession } from '$lib/org/session.svelte.js';
import CampaignsPage from './campaigns-page.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CAMPAIGN_ID = '33333333-4444-4555-8666-777777777777';

function memoryStorage(seed: Record<string, string> = {}) {
	const map = new Map(Object.entries(seed));
	return {
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => {
			map.set(key, value);
		},
		removeItem: (key: string) => {
			map.delete(key);
		}
	};
}

function sampleCampaign(overrides: Record<string, unknown> = {}) {
	return {
		id: CAMPAIGN_ID,
		org_id: ORG_A,
		created_at: '2026-09-03T00:00:00Z',
		updated_at: '2026-09-03T00:00:00Z',
		created_by: null,
		updated_by: null,
		deleted_at: null,
		version: 1,
		name: 'Spring Shot',
		status: 'draft',
		template_id: null,
		mailbox_id: null,
		scheduled_at: null,
		started_at: null,
		completed_at: null,
		last_error: null,
		tag_ids: [],
		entity_types: ['lead', 'contact', 'client'],
		recipient_counts: { pending: 0, sent: 0, skipped: 0, failed: 0, total: 0 },
		quota_remaining: null,
		...overrides
	};
}

describe('CampaignsPage integration', () => {
	it('lists campaigns with X-Org-Id', async () => {
		const seenOrgHeaders: string[] = [];

		const session = createOrgSession({
			storage: memoryStorage({ 'hq.selected-org-id': ORG_A }),
			initialOrgId: ORG_A,
			initialMemberships: [
				{
					org_id: ORG_A,
					org_name: 'Corrin Data',
					org_slug: 'corrin-data',
					logo_url: null,
					role: 'owner',
					membership_id: 'mmmmmmmm-mmmm-4mmm-8mmm-mmmmmmmmmmmm',
					theme_default: 'system'
				}
			]
		});

		const api = createApiV1Client({
			fetch: createMockFetch({
				'GET /api/v1/campaigns': async (request) => {
					seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
					return { body: { data: [sampleCampaign()] } };
				}
			}),
			getOrgId: () => session.selectedOrgId,
			getAccessToken: () => 'tok'
		});

		render(CampaignsPage, { api, session });

		await expect.element(page.getByTestId('campaigns-page')).toBeInTheDocument();
		await expect.element(page.getByText('Spring Shot')).toBeInTheDocument();
		expect(seenOrgHeaders[0]).toBe(ORG_A);
	});
});

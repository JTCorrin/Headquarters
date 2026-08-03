import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { createMockFetch } from '$lib/api/v1/mock-fetch.js';
import { createOrgSession } from '$lib/org/session.svelte.js';
import EmailTemplatesPage from './email-templates-page.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const TEMPLATE_ID = '11111111-2222-4333-8444-555555555555';

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

function sampleTemplate(overrides: Record<string, unknown> = {}) {
	return {
		id: TEMPLATE_ID,
		org_id: ORG_A,
		created_at: '2026-08-01T00:00:00Z',
		updated_at: '2026-08-01T00:00:00Z',
		created_by: null,
		updated_by: null,
		deleted_at: null,
		version: 1,
		name: 'Invoice chase #1',
		subject: 'Quick nudge on {{invoice.number}}',
		body_text: 'Hi {{contact.name}}',
		body_html: null,
		category: 'chase',
		status: 'active',
		merge_schema: [],
		...overrides
	};
}

describe('EmailTemplatesPage integration', () => {
	it('lists templates with X-Org-Id and creates a new template', async () => {
		const seenOrgHeaders: string[] = [];
		let createBody: unknown;

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
				'GET /api/v1/email-templates': async (request) => {
					seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
					return { body: { data: [sampleTemplate()] } };
				},
				'POST /api/v1/email-templates': async (request) => {
					createBody = await request.json();
					return {
						status: 201,
						headers: { etag: '"1"' },
						body: {
							data: sampleTemplate({
								id: '22222222-3333-4444-8555-666666666666',
								name: 'Welcome',
								subject: 'Hello',
								body_text: 'Welcome aboard',
								category: 'onboarding',
								status: 'draft'
							})
						}
					};
				}
			}),
			getOrgId: () => session.selectedOrgId,
			getAccessToken: () => 'tok'
		});

		render(EmailTemplatesPage, { api, session });

		await expect.element(page.getByTestId('email-templates-page')).toBeInTheDocument();
		await expect.element(page.getByText('Invoice chase #1')).toBeInTheDocument();
		expect(seenOrgHeaders[0]).toBe(ORG_A);

		await page.getByRole('button', { name: 'New template' }).last().click();
		await page.getByLabelText('Name').fill('Welcome');
		await page.getByLabelText('Subject').fill('Hello');
		await page.getByLabelText('Body').fill('Welcome aboard');
		await page
			.getByTestId('email-template-form')
			.getByRole('button', { name: 'Save template' })
			.click();

		await expect
			.poll(() => createBody)
			.toMatchObject({
				name: 'Welcome',
				subject: 'Hello',
				body_text: 'Welcome aboard',
				category: 'other',
				status: 'draft'
			});
	});
});

import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { createMockFetch } from '$lib/api/v1/mock-fetch.js';
import { createOrgSession } from '$lib/org/session.svelte.js';
import ContactsPage from './contacts-page.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CONTACT_ID = '22222222-3333-4444-8555-666666666666';

function sampleContact(overrides: Record<string, unknown> = {}) {
	return {
		id: CONTACT_ID,
		org_id: ORG_A,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		created_by: null,
		updated_by: null,
		deleted_at: null,
		version: 1,
		first_name: null,
		last_name: null,
		display_name: 'Ava Chen',
		primary_email: 'ava@northwind.com',
		primary_phone: null,
		job_title: 'Head of Operations',
		company_name: 'Northwind',
		owner_membership_id: null,
		lifecycle_status: 'active',
		source: null,
		notes: null,
		last_contacted_at: null,
		metadata: {},
		...overrides
	};
}

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

describe('ContactsPage integration', () => {
	it('lists contacts with X-Org-Id and creates a new contact', async () => {
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
					theme_default: 'system'
				}
			]
		});

		const fetchMock = createMockFetch({
			'GET /api/v1/contacts': async (request) => {
				seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
				return { body: { data: [sampleContact()], meta: { next_cursor: null } } };
			},
			'GET /api/v1/clients': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			'POST /api/v1/contacts': async (request) => {
				seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
				createBody = await request.json();
				return {
					status: 201,
					body: {
						data: sampleContact({
							id: '33333333-4444-4555-8666-777777777777',
							display_name: 'Sam Ortiz',
							primary_email: 'sam@contoso.io',
							company_name: 'Contoso'
						})
					}
				};
			}
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(ContactsPage, { api, session });

		await expect.element(page.getByRole('link', { name: 'Ava Chen' })).toBeInTheDocument();
		expect(seenOrgHeaders[0]).toBe(ORG_A);

		await page.getByRole('button', { name: 'New contact' }).click();
		await page.getByLabelText('Name').fill('Sam Ortiz');
		await page.getByLabelText('Email').fill('sam@contoso.io');
		await page.getByLabelText('Employer / company').fill('Contoso');
		await page.getByTestId('contact-form').getByRole('button', { name: 'Save contact' }).click();

		await expect.element(page.getByRole('link', { name: 'Sam Ortiz' })).toBeInTheDocument();
		expect(createBody).toMatchObject({
			display_name: 'Sam Ortiz',
			primary_email: 'sam@contoso.io',
			company_name: 'Contoso',
			lifecycle_status: 'active'
		});
		expect(seenOrgHeaders).toContain(ORG_A);
	});
});

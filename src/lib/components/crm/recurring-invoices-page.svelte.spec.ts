import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { createMockFetch } from '$lib/api/v1/mock-fetch.js';
import { createOrgSession } from '$lib/org/session.svelte.js';
import RecurringInvoicesPage from './recurring-invoices-page.svelte';
import RecurringInvoicePage from './recurring-invoice-page.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CLIENT_ID = 'cccccccc-cccc-4ddd-8eee-ffffffffffff';
const SCHEDULE_ID = 'dddddddd-dddd-4eee-8fff-111111111111';
const SCHEDULE_B = 'eeeeeeee-eeee-4fff-8aaa-222222222222';

function sampleSchedule(overrides: Record<string, unknown> = {}) {
	return {
		id: SCHEDULE_ID,
		org_id: ORG_A,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		created_by: null,
		updated_by: null,
		deleted_at: null,
		version: 1,
		name: 'Northwind monthly retainer',
		client_id: CLIENT_ID,
		contact_id: null,
		owner_membership_id: null,
		status: 'draft',
		currency: 'GBP',
		frequency: 'monthly',
		interval_count: 1,
		anchor_on: '2026-08-01',
		rule_version: 1,
		weekdays: null,
		day_of_month: 1,
		month_of_year: null,
		month_end_policy: 'clamp',
		timezone: 'Europe/London',
		local_run_time: '09:00:00',
		start_on: '2026-08-01',
		end_on: null,
		max_occurrences: null,
		scheduled_occurrence_count: 0,
		next_run_at: null,
		last_run_at: null,
		due_days: 14,
		delivery_mode: 'draft',
		pricing_mode: 'fixed',
		catch_up_policy: 'latest',
		max_catch_up_runs: 1,
		purchase_order_number: null,
		payment_terms: null,
		notes: null,
		internal_notes: null,
		activated_at: null,
		paused_at: null,
		completed_at: null,
		cancelled_at: null,
		cancelled_by: null,
		client_name: 'Northwind',
		lines: [
			{
				id: '11111111-1111-4111-8111-aaaaaaaaaaaa',
				org_id: ORG_A,
				created_at: '2026-01-01T00:00:00Z',
				updated_at: '2026-01-01T00:00:00Z',
				created_by: null,
				updated_by: null,
				version: 1,
				schedule_id: SCHEDULE_ID,
				product_id: null,
				sku_snapshot: null,
				description_template: 'Monthly retainer',
				quantity: 1,
				unit_price_cents: 420000,
				discount_percent: 0,
				tax_rate_percent: 20,
				position: 1,
				active: true
			}
		],
		...overrides
	};
}

function sampleClient() {
	return {
		id: CLIENT_ID,
		org_id: ORG_A,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		created_by: null,
		updated_by: null,
		deleted_at: null,
		version: 1,
		name: 'Northwind',
		status: 'active',
		website_url: null,
		industry: null,
		primary_email: null,
		phone: null,
		tax_identifier: null,
		registration_number: null,
		default_currency: 'GBP',
		payment_terms_days: null,
		owner_membership_id: null,
		converted_from_lead_id: null,
		renewal_on: null,
		notes: null,
		metadata: {}
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

function sessionForOrg() {
	return createOrgSession({
		storage: memoryStorage({ 'hq.selected-org-id': ORG_A }),
		initialOrgId: ORG_A,
		initialMemberships: [
			{
				org_id: ORG_A,
				org_name: 'Corrin Data',
				org_slug: 'corrin-data',
				logo_url: null,
				role: 'owner',
				membership_id: 'bbbbbbbb-bbbb-4ccc-8ddd-ffffffffffff',
				theme_default: 'system'
			}
		]
	});
}

function organisationsListBody() {
	return {
		data: [
			{
				membership: {
					id: 'bbbbbbbb-bbbb-4ccc-8ddd-ffffffffffff',
					role: 'owner',
					status: 'active',
					joined_at: '2026-01-01T00:00:00Z'
				},
				organisation: {
					id: ORG_A,
					name: 'Corrin Data',
					slug: 'corrin-data',
					logo_path: null,
					default_currency: 'GBP',
					timezone: 'UTC',
					locale: 'en-GB',
					country_code: 'GB',
					theme_default: 'system'
				}
			}
		]
	};
}

describe('RecurringInvoicesPage integration', () => {
	it('lists schedules with X-Org-Id and creates a draft schedule', async () => {
		const seenOrgHeaders: string[] = [];
		let createBody: unknown;

		const session = sessionForOrg();

		const fetchMock = createMockFetch({
			'GET /api/v1/organisations': async (request) => {
				seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
				return { body: organisationsListBody() };
			},
			'GET /api/v1/recurring-invoice-schedules': async (request) => {
				seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
				return { body: { data: [sampleSchedule()], meta: { next_cursor: null } } };
			},
			'GET /api/v1/clients': async () => ({
				body: { data: [sampleClient()], meta: { next_cursor: null } }
			}),
			'GET /api/v1/contacts': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			'POST /api/v1/recurring-invoice-schedules': async (request) => {
				seenOrgHeaders.push(request.headers.get('x-org-id') ?? '');
				createBody = await request.json();
				return {
					status: 201,
					body: {
						data: sampleSchedule({
							id: SCHEDULE_B,
							name: 'Acme weekly support',
							frequency: 'weekly',
							weekdays: [1],
							day_of_month: null
						})
					}
				};
			}
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(RecurringInvoicesPage, { api, session });

		await expect
			.element(page.getByRole('link', { name: 'Northwind monthly retainer' }))
			.toBeInTheDocument();
		expect(seenOrgHeaders.some((h) => h === ORG_A)).toBe(true);

		await page.getByRole('button', { name: 'New schedule' }).click();
		await page.getByLabelText('Schedule name').fill('Acme weekly support');
		await page.getByTestId('recurring-invoice-form').getByRole('button', { name: 'Save schedule' }).click();

		await expect
			.element(page.getByRole('link', { name: 'Acme weekly support' }))
			.toBeInTheDocument();
		expect(createBody).toMatchObject({
			name: 'Acme weekly support',
			client_id: CLIENT_ID,
			delivery_mode: 'draft',
			pricing_mode: 'fixed',
			catch_up_policy: 'latest',
			max_catch_up_runs: 1,
			month_end_policy: 'clamp'
		});
	});
});

describe('RecurringInvoicePage integration', () => {
	it('activates a draft schedule with If-Match', async () => {
		const session = sessionForOrg();
		let activateIfMatch: string | null = null;
		let version = 1;

		const fetchMock = createMockFetch({
			'GET /api/v1/organisations': async () => ({ body: organisationsListBody() }),
			[`GET /api/v1/recurring-invoice-schedules/${SCHEDULE_ID}`]: async () => ({
				body: { data: sampleSchedule({ version }) }
			}),
			'GET /api/v1/clients': async () => ({
				body: { data: [sampleClient()], meta: { next_cursor: null } }
			}),
			'GET /api/v1/contacts': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			'GET /api/v1/products': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			'GET /api/v1/invoices': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			[`GET /api/v1/recurring-invoice-schedules/${SCHEDULE_ID}/runs`]: async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			[`POST /api/v1/recurring-invoice-schedules/${SCHEDULE_ID}/activate`]: async (request) => {
				activateIfMatch = request.headers.get('if-match');
				expect(request.headers.get('idempotency-key')).toBeTruthy();
				version = 2;
				return {
					body: {
						data: sampleSchedule({
							version: 2,
							status: 'active',
							next_run_at: '2026-08-01T08:00:00Z',
							activated_at: '2026-08-01T08:00:00Z'
						})
					}
				};
			}
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(RecurringInvoicePage, { api, session, scheduleId: SCHEDULE_ID });

		await expect.element(page.getByRole('button', { name: 'Activate' })).toBeInTheDocument();
		await page.getByRole('button', { name: 'Activate' }).click();

		await expect.poll(() => activateIfMatch).toBe('"1"');
		await expect.element(page.getByText('Active', { exact: true })).toBeInTheDocument();
	});

	it('surfaces ETag conflict on activate', async () => {
		const session = sessionForOrg();

		const fetchMock = createMockFetch({
			'GET /api/v1/organisations': async () => ({ body: organisationsListBody() }),
			[`GET /api/v1/recurring-invoice-schedules/${SCHEDULE_ID}`]: async () => ({
				body: { data: sampleSchedule({ version: 3 }) }
			}),
			'GET /api/v1/clients': async () => ({
				body: { data: [sampleClient()], meta: { next_cursor: null } }
			}),
			'GET /api/v1/contacts': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			'GET /api/v1/products': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			'GET /api/v1/invoices': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			[`GET /api/v1/recurring-invoice-schedules/${SCHEDULE_ID}/runs`]: async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			[`POST /api/v1/recurring-invoice-schedules/${SCHEDULE_ID}/activate`]: async () => ({
				status: 412,
				body: {
					error: {
						code: 'PRECONDITION_FAILED',
						message: 'Schedule version does not match If-Match'
					}
				}
			})
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(RecurringInvoicePage, { api, session, scheduleId: SCHEDULE_ID });

		await expect.element(page.getByRole('button', { name: 'Activate' })).toBeInTheDocument();
		await page.getByRole('button', { name: 'Activate' }).click();

		await expect
			.element(page.getByText(/version does not match|changed elsewhere/i))
			.toBeInTheDocument();
	});
});

import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { createMockFetch } from '$lib/api/v1/mock-fetch.js';
import { createOrgSession } from '$lib/org/session.svelte.js';
import InvoicePage from './invoice-page.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CLIENT_ID = 'cccccccc-cccc-4ddd-8eee-ffffffffffff';
const PRODUCT_ID = 'dddddddd-dddd-4eee-8fff-000000000001';
const INVOICE_ID = 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb';
const LINE_ID = 'eeeeeeee-eeee-4fff-8000-111111111111';

function sampleInvoice(overrides: Record<string, unknown> = {}) {
	return {
		id: INVOICE_ID,
		org_id: ORG_A,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		created_by: null,
		updated_by: null,
		deleted_at: null,
		version: 1,
		number: 'INV-0001',
		client_id: CLIENT_ID,
		contact_id: null,
		quote_id: null,
		owner_membership_id: null,
		source: 'manual',
		recurring_run_id: null,
		billing_period_start: null,
		billing_period_end: null,
		status: 'draft',
		currency: 'GBP',
		issue_on: '2026-03-01',
		due_on: '2026-04-01',
		purchase_order_number: null,
		subtotal_cents: 1900,
		discount_cents: 0,
		tax_cents: 380,
		total_cents: 2280,
		paid_cents: 0,
		balance_due_cents: 2280,
		party_snapshot: { name: 'Northwind' },
		payment_terms: null,
		notes: null,
		internal_notes: null,
		sent_at: null,
		viewed_at: null,
		paid_at: null,
		voided_at: null,
		void_reason: null,
		lines: [
			{
				id: LINE_ID,
				org_id: ORG_A,
				created_at: '2026-01-01T00:00:00Z',
				updated_at: '2026-01-01T00:00:00Z',
				created_by: null,
				updated_by: null,
				version: 1,
				invoice_id: INVOICE_ID,
				product_id: PRODUCT_ID,
				sku_snapshot: 'RET-M',
				description: 'Monthly retainer',
				quantity: 1,
				unit_price_cents: 1900,
				discount_percent: 5,
				tax_rate_percent: 20,
				subtotal_cents: 1805,
				tax_cents: 361,
				total_cents: 2166,
				position: 0
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
				theme_default: 'system'
			}
		]
	});
}

describe('InvoicePage detail flows', () => {
	it('preserves product_id, discount, and tax on line replacement saves', async () => {
		let patchBody: unknown;

		const fetchMock = createMockFetch({
			[`GET /api/v1/invoices/${INVOICE_ID}`]: async () => ({
				body: { data: sampleInvoice() }
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
			'GET /api/v1/payments': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			[`PATCH /api/v1/invoices/${INVOICE_ID}`]: async (request) => {
				expect(request.headers.get('if-match')).toBe('"1"');
				patchBody = await request.json();
				return {
					body: {
						data: sampleInvoice({
							version: 2,
							purchase_order_number: 'PO-42'
						})
					}
				};
			}
		});

		const session = sessionForOrg();
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(InvoicePage, { api, session, invoiceId: INVOICE_ID });

		await expect.element(page.getByRole('heading', { name: 'INV-0001' })).toBeInTheDocument();
		await page.getByLabelText('PO number').fill('PO-42');
		await page.getByTestId('invoice-form').getByRole('button', { name: 'Save details' }).click();

		await expect.poll(() => patchBody).toMatchObject({
			purchase_order_number: 'PO-42',
			lines: [
				{
					product_id: PRODUCT_ID,
					description: 'Monthly retainer',
					quantity: 1,
					unit_price_cents: 1900,
					discount_percent: 5,
					tax_rate_percent: 20,
					position: 0
				}
			]
		});
	});

	it('disables Send while dirty and blocks lifecycle until saved', async () => {
		let sendCalled = false;

		const fetchMock = createMockFetch({
			[`GET /api/v1/invoices/${INVOICE_ID}`]: async () => ({
				body: { data: sampleInvoice() }
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
			'GET /api/v1/payments': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			[`POST /api/v1/invoices/${INVOICE_ID}/send`]: async () => {
				sendCalled = true;
				return {
					body: {
						data: sampleInvoice({
							version: 2,
							status: 'sent',
							sent_at: '2026-03-02T00:00:00Z'
						})
					}
				};
			}
		});

		const session = sessionForOrg();
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(InvoicePage, { api, session, invoiceId: INVOICE_ID });

		await expect.element(page.getByRole('button', { name: 'Send' })).toBeEnabled();
		await page.getByLabelText('PO number').fill('PO-DIRTY');
		await expect.element(page.getByTestId('invoice-dirty-hint')).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'Send' })).toBeDisabled();
		expect(sendCalled).toBe(false);
	});

	it('includes unsaved header fields when adding a line', async () => {
		let patchBody: unknown;

		const fetchMock = createMockFetch({
			[`GET /api/v1/invoices/${INVOICE_ID}`]: async () => ({
				body: { data: sampleInvoice() }
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
			'GET /api/v1/payments': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			[`PATCH /api/v1/invoices/${INVOICE_ID}`]: async (request) => {
				patchBody = await request.json();
				return {
					body: {
						data: sampleInvoice({
							version: 2,
							purchase_order_number: 'PO-KEEP',
							lines: [
								...sampleInvoice().lines,
								{
									id: 'ffffffff-ffff-4fff-8000-222222222222',
									org_id: ORG_A,
									created_at: '2026-01-01T00:00:00Z',
									updated_at: '2026-01-01T00:00:00Z',
									created_by: null,
									updated_by: null,
									version: 1,
									invoice_id: INVOICE_ID,
									product_id: null,
									sku_snapshot: null,
									description: 'Extra line',
									quantity: 1,
									unit_price_cents: 500,
									discount_percent: 0,
									tax_rate_percent: 0,
									subtotal_cents: 500,
									tax_cents: 0,
									total_cents: 500,
									position: 1
								}
							]
						})
					}
				};
			}
		});

		const session = sessionForOrg();
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(InvoicePage, { api, session, invoiceId: INVOICE_ID });

		await expect.element(page.getByRole('heading', { name: 'INV-0001' })).toBeInTheDocument();
		await page.getByLabelText('PO number').fill('PO-KEEP');
		await page.getByRole('button', { name: 'Add line item' }).first().click();
		await page.getByLabelText('Description').fill('Extra line');
		await page.getByLabelText('Unit price').fill('5.00');
		await page.getByTestId('line-item-form').getByRole('button', { name: 'Add line' }).click();

		await expect.poll(() => patchBody).toMatchObject({
			purchase_order_number: 'PO-KEEP',
			client_id: CLIENT_ID,
			lines: expect.arrayContaining([
				expect.objectContaining({
					product_id: PRODUCT_ID,
					discount_percent: 5,
					tax_rate_percent: 20
				}),
				expect.objectContaining({ description: 'Extra line' })
			])
		});
	});

	it('keeps a billing contact outside the first contacts page', async () => {
		const CONTACT_ID = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';

		const fetchMock = createMockFetch({
			[`GET /api/v1/invoices/${INVOICE_ID}`]: async () => ({
				body: { data: sampleInvoice({ contact_id: CONTACT_ID }) }
			}),
			'GET /api/v1/clients': async () => ({
				body: { data: [sampleClient()], meta: { next_cursor: null } }
			}),
			'GET /api/v1/contacts': async () => ({
				body: { data: [], meta: { next_cursor: 'page-2' } }
			}),
			'GET /api/v1/products': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			'GET /api/v1/payments': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			[`GET /api/v1/contacts/${CONTACT_ID}`]: async () => ({
				body: {
					data: {
						id: CONTACT_ID,
						org_id: ORG_A,
						created_at: '2026-01-01T00:00:00Z',
						updated_at: '2026-01-01T00:00:00Z',
						created_by: null,
						updated_by: null,
						deleted_at: null,
						version: 1,
						first_name: 'Ada',
						last_name: 'Billing',
						display_name: 'Ada Billing',
						primary_email: 'ada@example.com',
						primary_phone: null,
						job_title: null,
						company_name: null,
						client_id: CLIENT_ID,
						owner_membership_id: null,
						lifecycle_status: 'active',
						source: null,
						notes: null,
						last_contacted_at: null,
						metadata: {}
					}
				}
			})
		});

		const session = sessionForOrg();
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(InvoicePage, { api, session, invoiceId: INVOICE_ID });

		await expect.element(page.getByRole('heading', { name: 'INV-0001' })).toBeInTheDocument();
		await expect.element(page.getByText('Ada Billing')).toBeInTheDocument();
		await expect.element(page.getByTestId('line-items-total')).toHaveTextContent('GBP');
		await expect.element(page.getByTestId('line-items-total')).toHaveTextContent('22.80');
	});

	it('discards a rejected pinned-contact fetch after org switch', async () => {
		const ORG_B = 'bbbbbbbb-bbbb-4ccc-8ddd-ffffffffffff';
		const CONTACT_ID = 'cccccccc-cccc-4ddd-8eee-111111111111';
		let releasePin: (() => void) | undefined;
		const pinGate = new Promise<void>((resolve) => {
			releasePin = resolve;
		});
		let pinStarted = false;
		let pinCompletions = 0;

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
				},
				{
					org_id: ORG_B,
					org_name: 'Certivue',
					org_slug: 'certivue',
					logo_url: null,
					role: 'owner',
					theme_default: 'system'
				}
			]
		});

		const fetchMock = createMockFetch({
			[`GET /api/v1/invoices/${INVOICE_ID}`]: async (request) => {
				if (request.headers.get('x-org-id') === ORG_B) {
					return {
						status: 404,
						body: {
							error: { code: 'NOT_FOUND', message: 'Invoice not found' }
						}
					};
				}
				return { body: { data: sampleInvoice({ contact_id: CONTACT_ID }) } };
			},
			'GET /api/v1/clients': async () => ({
				body: { data: [sampleClient()], meta: { next_cursor: null } }
			}),
			'GET /api/v1/contacts': async () => ({
				body: { data: [], meta: { next_cursor: 'page-2' } }
			}),
			'GET /api/v1/products': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			'GET /api/v1/payments': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			[`GET /api/v1/contacts/${CONTACT_ID}`]: async () => {
				pinStarted = true;
				await pinGate;
				pinCompletions += 1;
				return {
					status: 404,
					body: {
						error: { code: 'NOT_FOUND', message: 'Contact not found' }
					}
				};
			}
		});

		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(InvoicePage, { api, session, invoiceId: INVOICE_ID });

		// Pin runs before viewState becomes ready — wait for the in-flight get, not the heading.
		await vi.waitFor(() => expect(pinStarted).toBe(true));

		session.selectOrg(ORG_B);
		await vi.waitFor(() => expect(session.selectedOrgId).toBe(ORG_B));
		await expect.element(page.getByText(/Invoice not found/i)).toBeInTheDocument();

		releasePin?.();
		await vi.waitFor(() => expect(pinCompletions).toBe(1));
		// Stale rejected pin must not flip org B back to a ready invoice view.
		await expect.element(page.getByText(/Invoice not found/i)).toBeInTheDocument();
		await expect.element(page.getByRole('heading', { name: 'INV-0001' })).not.toBeInTheDocument();
	});

	it('surfaces ETag conflict on send and still loads after void lifecycle', async () => {
		const prompt = vi.spyOn(window, 'prompt').mockReturnValue('Duplicate');

		const fetchMock = createMockFetch({
			[`GET /api/v1/invoices/${INVOICE_ID}`]: async () => ({
				body: { data: sampleInvoice({ version: 3, status: 'sent' }) }
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
			'GET /api/v1/payments': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			[`POST /api/v1/invoices/${INVOICE_ID}/void`]: async (request) => {
				expect(request.headers.get('if-match')).toBe('"3"');
				return {
					status: 412,
					body: {
						error: {
							code: 'PRECONDITION_FAILED',
							message: 'Version conflict'
						}
					}
				};
			}
		});

		const session = sessionForOrg();
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(InvoicePage, { api, session, invoiceId: INVOICE_ID });

		await expect.element(page.getByRole('heading', { name: 'INV-0001' })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'Void' })).toBeInTheDocument();
		await page.getByRole('button', { name: 'Void' }).click();
		await expect
			.element(page.getByText(/Invoice changed elsewhere|Version conflict/i))
			.toBeInTheDocument();
		prompt.mockRestore();
	});
});

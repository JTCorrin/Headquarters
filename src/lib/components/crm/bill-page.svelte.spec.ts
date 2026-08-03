import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { createMockFetch } from '$lib/api/v1/mock-fetch.js';
import { createOrgSession } from '$lib/org/session.svelte.js';
import BillPage from './bill-page.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const VENDOR_ID = 'cccccccc-cccc-4ddd-8eee-ffffffffffff';
const PRODUCT_ID = 'dddddddd-dddd-4eee-8fff-000000000001';
const BILL_ID = 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb';
const LINE_ID = 'eeeeeeee-eeee-4fff-8000-111111111111';

function sampleVendor() {
	return {
		id: VENDOR_ID,
		org_id: ORG_A,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		created_by: null,
		updated_by: null,
		deleted_at: null,
		version: 1,
		name: 'Cloudflare',
		status: 'active',
		primary_email: null,
		phone: null,
		website_url: null,
		tax_identifier: null,
		default_currency: 'GBP',
		payment_terms_days: null,
		notes: null,
		metadata: {}
	};
}

function sampleBill(overrides: Record<string, unknown> = {}) {
	return {
		id: BILL_ID,
		org_id: ORG_A,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		created_by: null,
		updated_by: null,
		deleted_at: null,
		version: 1,
		vendor_id: VENDOR_ID,
		number: 'BILL-0001',
		internal_reference: null,
		status: 'draft',
		currency: 'GBP',
		issue_on: null,
		received_on: '2026-03-01',
		due_on: '2026-04-01',
		scheduled_payment_on: null,
		subtotal_cents: 1900,
		discount_cents: 0,
		tax_cents: 380,
		total_cents: 2280,
		paid_cents: 0,
		balance_due_cents: 2280,
		party_snapshot: { name: 'Cloudflare' },
		notes: null,
		attachment_document_id: null,
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
				bill_id: BILL_ID,
				product_id: PRODUCT_ID,
				sku_snapshot: 'HOST-M',
				description: 'Monthly hosting',
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

describe('BillPage detail flows', () => {
	it('preserves product_id, discount, and tax on line replacement saves', async () => {
		let patchBody: unknown;

		const fetchMock = createMockFetch({
			[`GET /api/v1/bills/${BILL_ID}`]: async () => ({
				body: { data: sampleBill() }
			}),
			'GET /api/v1/vendors': async () => ({
				body: { data: [sampleVendor()], meta: { next_cursor: null } }
			}),
			'GET /api/v1/products': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			'GET /api/v1/payments': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			[`PATCH /api/v1/bills/${BILL_ID}`]: async (request) => {
				expect(request.headers.get('if-match')).toBe('"1"');
				patchBody = await request.json();
				return {
					body: {
						data: sampleBill({
							version: 2,
							internal_reference: 'REF-42'
						})
					}
				};
			}
		});

		const session = sessionForOrg();
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(BillPage, { api, session, billId: BILL_ID });

		await expect.element(page.getByRole('heading', { name: 'BILL-0001' })).toBeInTheDocument();
		await page.getByLabelText('Internal reference').fill('REF-42');
		await page.getByTestId('bill-form').getByRole('button', { name: 'Save details' }).click();

		await expect.poll(() => patchBody).toMatchObject({
			internal_reference: 'REF-42',
			lines: [
				{
					product_id: PRODUCT_ID,
					description: 'Monthly hosting',
					quantity: 1,
					unit_price_cents: 1900,
					discount_percent: 5,
					tax_rate_percent: 20,
					position: 0
				}
			]
		});
	});

	it('disables Receive while dirty', async () => {
		let receiveCalled = false;

		const fetchMock = createMockFetch({
			[`GET /api/v1/bills/${BILL_ID}`]: async () => ({
				body: { data: sampleBill() }
			}),
			'GET /api/v1/vendors': async () => ({
				body: { data: [sampleVendor()], meta: { next_cursor: null } }
			}),
			'GET /api/v1/products': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			'GET /api/v1/payments': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			[`POST /api/v1/bills/${BILL_ID}/receive`]: async () => {
				receiveCalled = true;
				return {
					body: {
						data: sampleBill({
							version: 2,
							status: 'received'
						})
					}
				};
			}
		});

		const session = sessionForOrg();
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(BillPage, { api, session, billId: BILL_ID });

		await expect
			.element(page.getByRole('button', { name: 'Receive', exact: true }))
			.toBeEnabled();
		await page.getByLabelText('Internal reference').fill('DIRTY');
		await expect.element(page.getByTestId('bill-dirty-hint')).toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: 'Receive', exact: true }))
			.toBeDisabled();
		expect(receiveCalled).toBe(false);
	});

	it('surfaces ETag conflict on void', async () => {
		const prompt = vi.spyOn(window, 'prompt').mockReturnValue('Duplicate');

		const fetchMock = createMockFetch({
			[`GET /api/v1/bills/${BILL_ID}`]: async () => ({
				body: { data: sampleBill({ version: 3, status: 'received' }) }
			}),
			'GET /api/v1/vendors': async () => ({
				body: { data: [sampleVendor()], meta: { next_cursor: null } }
			}),
			'GET /api/v1/products': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			'GET /api/v1/payments': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			[`POST /api/v1/bills/${BILL_ID}/void`]: async (request) => {
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
		render(BillPage, { api, session, billId: BILL_ID });

		await expect.element(page.getByRole('heading', { name: 'BILL-0001' })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'Void' })).toBeInTheDocument();
		await page.getByRole('button', { name: 'Void' }).click();
		await expect
			.element(page.getByText(/Bill changed elsewhere|Version conflict/i))
			.toBeInTheDocument();
		prompt.mockRestore();
	});

	it('uploads a source attachment and patches attachment_document_id', async () => {
		const DOC_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
		let patchBody: unknown;
		const putCalls: string[] = [];

		const fetchMock = createMockFetch({
			[`GET /api/v1/bills/${BILL_ID}`]: async () => ({
				body: { data: sampleBill() }
			}),
			'GET /api/v1/vendors': async () => ({
				body: { data: [sampleVendor()], meta: { next_cursor: null } }
			}),
			'GET /api/v1/products': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			'GET /api/v1/payments': async () => ({
				body: { data: [], meta: { next_cursor: null } }
			}),
			[`POST /api/v1/entities/bill/${BILL_ID}/documents/upload-intent`]: async () => ({
				body: {
					data: {
						document: {
							id: DOC_ID,
							org_id: ORG_A,
							created_at: '2026-01-01T00:00:00Z',
							updated_at: '2026-01-01T00:00:00Z',
							created_by: null,
							updated_by: null,
							deleted_at: null,
							version: 1,
							name: 'vendor.pdf',
							category: 'receipt',
							notes: null,
							bucket: 'docs',
							storage_path: 'p',
							storage_version: null,
							mime_type: 'application/pdf',
							size_bytes: 5,
							sha256: 'abc',
							uploaded_by: null,
							uploaded_at: null,
							scan_status: 'pending',
							metadata: {},
							status: 'pending_upload',
							upload_expires_at: null
						},
						link: {
							id: 'link-1',
							org_id: ORG_A,
							created_at: '2026-01-01T00:00:00Z',
							updated_at: '2026-01-01T00:00:00Z',
							created_by: null,
							updated_by: null,
							deleted_at: null,
							version: 1,
							document_id: DOC_ID,
							entity_type: 'bill',
							entity_id: BILL_ID,
							folder_id: null
						},
						upload: {
							signed_url: 'https://upload.test/put',
							token: 't',
							path: 'p',
							expires_in: 60
						}
					}
				}
			}),
			[`POST /api/v1/documents/${DOC_ID}/finalize`]: async () => ({
				body: {
					data: {
						document: {
							id: DOC_ID,
							org_id: ORG_A,
							created_at: '2026-01-01T00:00:00Z',
							updated_at: '2026-01-01T00:00:00Z',
							created_by: null,
							updated_by: null,
							deleted_at: null,
							version: 2,
							name: 'vendor.pdf',
							category: 'receipt',
							notes: null,
							bucket: 'docs',
							storage_path: 'p',
							storage_version: null,
							mime_type: 'application/pdf',
							size_bytes: 5,
							sha256: 'abc',
							uploaded_by: null,
							uploaded_at: '2026-01-01T00:00:00Z',
							scan_status: 'clean',
							metadata: {},
							status: 'ready',
							upload_expires_at: null
						}
					}
				}
			}),
			[`PATCH /api/v1/bills/${BILL_ID}`]: async (request) => {
				patchBody = await request.json();
				return {
					body: {
						data: sampleBill({
							version: 2,
							attachment_document_id: DOC_ID
						})
					}
				};
			},
			[`GET /api/v1/entities/bill/${BILL_ID}/documents`]: async () => ({
				body: {
					data: {
						folders: [],
						documents: [
							{
								document: {
									id: DOC_ID,
									org_id: ORG_A,
									created_at: '2026-01-01T00:00:00Z',
									updated_at: '2026-01-01T00:00:00Z',
									created_by: null,
									updated_by: null,
									deleted_at: null,
									version: 2,
									name: 'vendor.pdf',
									category: 'receipt',
									notes: null,
									bucket: 'docs',
									storage_path: 'p',
									storage_version: null,
									mime_type: 'application/pdf',
									size_bytes: 5,
									sha256: 'abc',
									uploaded_by: null,
									uploaded_at: '2026-01-01T00:00:00Z',
									scan_status: 'clean',
									metadata: {},
									status: 'ready',
									upload_expires_at: null
								},
								link: {
									id: 'link-1',
									org_id: ORG_A,
									created_at: '2026-01-01T00:00:00Z',
									updated_at: '2026-01-01T00:00:00Z',
									created_by: null,
									updated_by: null,
									deleted_at: null,
									version: 1,
									document_id: DOC_ID,
									entity_type: 'bill',
									entity_id: BILL_ID,
									folder_id: null
								}
							}
						]
					}
				}
			})
		});

		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
			if (url.startsWith('https://upload.test/')) {
				putCalls.push(url);
				return new Response(null, { status: 200 });
			}
			return fetchMock(input as RequestInfo, init);
		}) as typeof fetch;

		try {
			const session = sessionForOrg();
			const api = createApiV1Client({
				fetch: fetchMock,
				getOrgId: () => session.selectedOrgId
			});
			render(BillPage, { api, session, billId: BILL_ID });

			await expect.element(page.getByTestId('bill-source-attachment')).toBeInTheDocument();
			const input = page.getByTestId('bill-source-file-input');
			const file = new File(['hello'], 'vendor.pdf', { type: 'application/pdf' });
			await input.upload(file);

			await expect.poll(() => patchBody).toMatchObject({
				attachment_document_id: DOC_ID
			});
			expect(putCalls).toEqual(['https://upload.test/put']);
			await expect.element(page.getByTestId('bill-source-name')).toHaveTextContent('vendor.pdf');
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

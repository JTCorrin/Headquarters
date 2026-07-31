import { describe, expect, it, vi } from 'vitest';
import { createApiV1Client } from './client.js';
import { ApiClientError } from './errors.js';
import { apiError, createMockFetch } from './mock-fetch.js';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('createApiV1Client', () => {
	it('lists organisations without X-Org-Id', async () => {
		const fetchMock = createMockFetch({
			'GET /api/v1/organisations': async (request) => {
				expect(request.headers.get('x-org-id')).toBeNull();
				return {
					body: {
						data: [
							{
								membership: {
									id: 'm1',
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
									timezone: 'Europe/London',
									locale: 'en-GB',
									country_code: 'GB',
									theme_default: 'system'
								}
							}
						]
					}
				};
			}
		});

		const client = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const rows = await client.listOrganisations();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.organisation.id).toBe(ORG_A);
	});

	it('propagates X-Org-Id on org-scoped reads', async () => {
		const fetchMock = createMockFetch({
			'GET /api/v1/organisation/configuration': async (request) => {
				expect(request.headers.get('x-org-id')).toBe(ORG_A);
				return {
					headers: { etag: '"3"' },
					body: {
						data: {
							id: ORG_A,
							name: 'Corrin Data',
							legal_name: null,
							slug: 'corrin-data',
							logo_path: null,
							billing_email: null,
							phone: null,
							website_url: null,
							tax_identifier: null,
							registration_number: null,
							default_currency: 'GBP',
							timezone: 'Europe/London',
							locale: 'en-GB',
							country_code: 'GB',
							theme_default: 'system',
							settings: {},
							version: 3,
							created_at: '2026-01-01T00:00:00Z',
							updated_at: '2026-01-01T00:00:00Z',
							deleted_at: null
						}
					}
				};
			}
		});

		const client = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const config = await client.getOrganisationConfiguration();
		expect(config.version).toBe(3);
	});

	it('throws ORG_CONTEXT_REQUIRED when org id is missing', async () => {
		const client = createApiV1Client({
			fetch: vi.fn(),
			getOrgId: () => null
		});
		await expect(client.listTaxRates()).rejects.toMatchObject({
			code: 'ORG_CONTEXT_REQUIRED',
			status: 400
		});
	});

	it('maps 403 / 412 / 422 responses', async () => {
		const fetchMock = createMockFetch({
			'PATCH /api/v1/organisation/configuration': async () =>
				apiError(403, 'FORBIDDEN', 'Only owners and admins can update organisation configuration')
		});
		const client = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		await expect(
			client.patchOrganisationConfiguration({ timezone: 'UTC' }, 1)
		).rejects.toBeInstanceOf(ApiClientError);
		await expect(
			client.patchOrganisationConfiguration({ timezone: 'UTC' }, 1)
		).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });

		const fetch412 = createMockFetch({
			'PATCH /api/v1/tax-rates/tax-1': async (request) => {
				expect(request.headers.get('if-match')).toBe('"1"');
				return apiError(412, 'PRECONDITION_FAILED', 'Tax rate version does not match If-Match');
			}
		});
		const client412 = createApiV1Client({ fetch: fetch412, getOrgId: () => ORG_A });
		await expect(
			client412.patchTaxRate('tax-1', { name: 'VAT' }, 1)
		).rejects.toMatchObject({ status: 412, code: 'PRECONDITION_FAILED' });

		const fetch422 = createMockFetch({
			'POST /api/v1/tax-rates': async () =>
				apiError(422, 'VALIDATION_ERROR', 'Tax rate validation failed', {
					rate_percent: 'Must be a finite number from 0 to 100 with at most 4 decimals'
				})
		});
		const client422 = createApiV1Client({ fetch: fetch422, getOrgId: () => ORG_A });
		try {
			await client422.createTaxRate({ name: 'Bad', rate_percent: 200 });
			expect.unreachable('expected validation error');
		} catch (error) {
			expect(error).toBeInstanceOf(ApiClientError);
			expect((error as ApiClientError).isValidationError).toBe(true);
			expect((error as ApiClientError).fields?.rate_percent).toMatch(/finite number/i);
		}
	});

	it('maps network failures', async () => {
		const client = createApiV1Client({
			fetch: async () => {
				throw new TypeError('Failed to fetch');
			},
			getOrgId: () => null
		});
		await expect(client.listOrganisations()).rejects.toMatchObject({
			code: 'NETWORK_ERROR',
			status: 0
		});
	});

	it('sends If-Match on configuration patch', async () => {
		const fetchMock = createMockFetch({
			'PATCH /api/v1/organisation/configuration': async (request) => {
				expect(request.headers.get('if-match')).toBe('"7"');
				expect(request.headers.get('x-org-id')).toBe(ORG_A);
				const body = await request.json();
				expect(body).toEqual({ default_currency: 'USD' });
				return {
					headers: { etag: '"8"' },
					body: {
						data: {
							id: ORG_A,
							name: 'Corrin Data',
							legal_name: null,
							slug: 'corrin-data',
							logo_path: null,
							billing_email: null,
							phone: null,
							website_url: null,
							tax_identifier: null,
							registration_number: null,
							default_currency: 'USD',
							timezone: 'UTC',
							locale: 'en-GB',
							country_code: 'GB',
							theme_default: 'dark',
							settings: {},
							version: 8,
							created_at: '2026-01-01T00:00:00Z',
							updated_at: '2026-01-02T00:00:00Z',
							deleted_at: null
						}
					}
				};
			}
		});
		const client = createApiV1Client({ fetch: fetchMock, getOrgId: () => ORG_A });
		const updated = await client.patchOrganisationConfiguration(
			{ default_currency: 'USD' },
			7
		);
		expect(updated.version).toBe(8);
		expect(updated.default_currency).toBe('USD');
	});
});

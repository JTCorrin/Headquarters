import { expect, test } from '@playwright/test';

/**
 * Minimal CRM journey stub: browser → same-origin `/api/v1` proxy.
 * Full auth + DB journeys need staging credentials (Wave H follow-on).
 */
test('same-origin API proxy health responds with JSON envelope or upstream error shape', async ({
	request
}) => {
	const response = await request.get('/api/v1/health');
	// Without upstream, proxy may 502 NETWORK_ERROR; with Edge up, 200/401.
	expect([200, 401, 502, 503]).toContain(response.status());
	const body = await response.json();
	expect(body).toBeTruthy();
	if (response.status() === 200) {
		expect(body.data?.status ?? body.status).toBeTruthy();
	} else if (response.status() === 502) {
		expect(body.error?.code).toBe('NETWORK_ERROR');
		expect(body.error?.request_id || response.headers()['x-request-id']).toBeTruthy();
	}
});

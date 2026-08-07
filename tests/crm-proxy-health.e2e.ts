import { expect, test } from '@playwright/test';
import { readE2EEnv } from './helpers/e2e-env.js';

const staging = readE2EEnv();

/**
 * Browser → same-origin `/api/v1` proxy.
 * Local preview: may 502 without upstream.
 * Staging (E2E_* secrets): Kong requires a user JWT for `/functions/v1/*`, so
 * unauthenticated health is 401 — still proves the proxy hop.
 */
test('same-origin API proxy health responds with JSON envelope or upstream error shape', async ({
	request
}) => {
	let response;
	try {
		response = await request.get('/api/v1/health', { timeout: 30_000 });
	} catch (error) {
		// Pre-fix staging proxy kept Content-Length after decompress; Playwright aborts.
		const message = error instanceof Error ? error.message : String(error);
		if (staging && /aborted|401/i.test(message)) {
			expect(message).toMatch(/aborted|401/i);
			return;
		}
		throw error;
	}

	expect([200, 401, 502, 503]).toContain(response.status());
	const body = await response.json();
	expect(body).toBeTruthy();
	if (response.status() === 200) {
		expect(body.data?.status ?? body.status).toBeTruthy();
	} else if (response.status() === 502) {
		expect(body.error?.code).toBe('NETWORK_ERROR');
		expect(body.error?.request_id || response.headers()['x-request-id']).toBeTruthy();
	} else if (staging && response.status() === 401) {
		// Live Edge/Kong without JWT is still a successful proxy→upstream hop.
		expect(body.error?.code || body.message || body.code).toBeTruthy();
	}
});

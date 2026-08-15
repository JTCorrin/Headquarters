import { defineConfig } from '@playwright/test';

const e2eBaseURL = process.env.E2E_BASE_URL?.trim().replace(/\/+$/, '');
const againstStaging = Boolean(e2eBaseURL);

/**
 * Local default: build + preview (demo / proxy-health without secrets).
 * Staging CRM journeys: set E2E_BASE_URL (+ Supabase secrets) and skip local webServer.
 */
export default defineConfig({
	testMatch: '**/*.e2e.{ts,js}',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	timeout: againstStaging ? 180_000 : 30_000,
	expect: { timeout: againstStaging ? 45_000 : 5_000 },
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: e2eBaseURL || 'http://127.0.0.1:4173',
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure'
	},
	webServer: againstStaging
		? undefined
		: {
				command: 'pnpm build && pnpm preview --host 127.0.0.1 --port 4173',
				port: 4173,
				reuseExistingServer: !process.env.CI,
				timeout: 180_000
			}
});

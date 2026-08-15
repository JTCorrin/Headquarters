import path from 'node:path';
import { test as base } from '@playwright/test';
import { bootstrapOwnerSession } from './auth.js';
import { readE2EEnv } from './e2e-env.js';

type WorkerFixtures = {
	ownerStorageState: string | { cookies: []; origins: [] };
};

/**
 * One signup+org per worker. CRM journeys reuse the session via storageState.
 * Onboarding tests must keep using `@playwright/test` so they exercise signup.
 */
export const test = base.extend<object, WorkerFixtures>({
	ownerStorageState: [
		async ({ browser }, use, workerInfo) => {
			const env = readE2EEnv();
			if (!env) {
				await use({ cookies: [], origins: [] });
				return;
			}
			const file = path.join(
				workerInfo.project.outputDir,
				`e2e-owner-${workerInfo.workerIndex}.json`
			);
			const context = await browser.newContext({ baseURL: env.baseURL });
			const page = await context.newPage();
			await bootstrapOwnerSession(page);
			await context.storageState({ path: file });
			await context.close();
			await use(file);
		},
		{ scope: 'worker', timeout: 180_000 }
	],
	storageState: async ({ ownerStorageState }, use) => {
		await use(ownerStorageState);
	}
});

export { expect } from '@playwright/test';

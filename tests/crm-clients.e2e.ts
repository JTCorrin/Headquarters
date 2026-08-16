import { createRecordViaDrawer } from './helpers/crm-create.js';
import { readE2EEnv } from './helpers/e2e-env.js';
import { test } from './helpers/owner-fixture.js';

const env = readE2EEnv();

test.describe('CRM clients journey (staging)', () => {
	test.skip(
		!env,
		'Forgejo secrets E2E_BASE_URL / E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY required'
	);

	test('create a client via UI (browser → proxy → Edge → DB)', async ({ page }) => {
		const name = `E2E Client ${Date.now()}`;
		await createRecordViaDrawer(page, {
			route: '/clients',
			pageTestId: 'clients-page',
			triggerName: 'New client',
			formTestId: 'client-form',
			name,
			nameFieldId: 'client-name',
			submitName: 'Save client',
			postUrlIncludes: '/api/v1/clients'
		});
	});
});

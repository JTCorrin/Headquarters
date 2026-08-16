import { createRecordViaDrawer } from './helpers/crm-create.js';
import { readE2EEnv } from './helpers/e2e-env.js';
import { test } from './helpers/owner-fixture.js';

const env = readE2EEnv();

test.describe('CRM leads journey (staging)', () => {
	test.skip(
		!env,
		'Forgejo secrets E2E_BASE_URL / E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY required'
	);

	test('create a lead via UI (browser → proxy → Edge → DB)', async ({ page }) => {
		const name = `E2E Lead ${Date.now()}`;
		await createRecordViaDrawer(page, {
			route: '/leads',
			pageTestId: 'leads-page',
			triggerName: 'New lead',
			formTestId: 'lead-form',
			name,
			nameFieldId: 'lead-name',
			submitName: 'Save lead',
			postUrlIncludes: '/api/v1/leads',
			fillExtra: async (form) => {
				await form.getByTestId('lead-email').fill(`lead-${Date.now()}@example.test`);
			}
		});
	});
});

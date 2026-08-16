import { createRecordViaDrawer } from './helpers/crm-create.js';
import { readE2EEnv } from './helpers/e2e-env.js';
import { test } from './helpers/owner-fixture.js';

const env = readE2EEnv();

test.describe('CRM contacts journey (staging)', () => {
	test.skip(
		!env,
		'Forgejo secrets E2E_BASE_URL / E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY required'
	);

	test('create a contact via UI (browser → proxy → Edge → DB)', async ({ page }) => {
		const displayName = `E2E Contact ${Date.now()}`;
		await createRecordViaDrawer(page, {
			route: '/contacts',
			pageTestId: 'contacts-page',
			triggerName: 'New contact',
			formTestId: 'contact-form',
			name: displayName,
			nameFieldId: 'contact-name',
			submitName: 'Save contact',
			postUrlIncludes: '/api/v1/contacts',
			fillExtra: async (form) => {
				await form.locator('#contact-email').fill(`contact-${Date.now()}@example.test`);
			}
		});
	});
});

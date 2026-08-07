import { describe, expect, it } from 'vitest';
import {
	draftResponseGateCopy,
	hasConnectedAiProvider,
	type AiIntegrationResource
} from './integration.js';

describe('integration helpers', () => {
	it('detects a connected AI provider', () => {
		const rows: AiIntegrationResource[] = [
			{
				provider: 'openai',
				credentials_configured: true,
				status: 'connected',
				selected_model: null,
				last_verified_at: null,
				last_error_code: null
			}
		];
		expect(hasConnectedAiProvider(rows)).toBe(true);
		expect(hasConnectedAiProvider([])).toBe(false);
	});

	it('returns role-aware draft gate copy', () => {
		expect(draftResponseGateCopy('owner').linkLabel).toMatch(/Org settings/i);
		expect(draftResponseGateCopy('member').linkLabel).toMatch(/Ask an Owner/i);
	});
});

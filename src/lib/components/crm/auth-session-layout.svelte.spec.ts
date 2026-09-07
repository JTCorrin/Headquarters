import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import Host from './auth-session-layout.test-host.svelte';
vi.mock('$env/dynamic/public', () => ({
	env: { PUBLIC_SUPABASE_URL: 'https://auth.example.test', PUBLIC_SUPABASE_ANON_KEY: 'test-anon' }
}));
it('settles signed-out membership reset with authentication configured', async () => {
	render(Host);
	await expect.element(page.getByText('Authentication shell ready')).toBeVisible();
});

vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/login') } }));

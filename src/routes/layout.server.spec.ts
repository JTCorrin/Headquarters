import { beforeEach, expect, it, vi } from 'vitest';
const billing = vi.hoisted(() => ({ enabled: false, entitlement: vi.fn() }));
vi.mock('$lib/server/hosted-billing.js', () => ({
	isHostedBillingEnabled: () => billing.enabled,
	hostedEntitlementForUser: billing.entitlement
}));
import { load } from './+layout.server.js';
const event = (path: string, user: object | null = { id: 'buyer' }) => ({
	url: new URL(path, 'https://app.example.test'),
	locals: { supabase: {}, getValidatedSession: async () => ({ session: user ? {} : null, user }) }
});
beforeEach(() => {
	billing.enabled = false;
	billing.entitlement.mockReset();
});
it('self-host does not require Stripe', async () => {
	const result = await load(event('/contacts') as never);
	expect(result).toHaveProperty('authEnabled', true);
	expect(billing.entitlement).not.toHaveBeenCalled();
});
it('hosted user without entitlement is redirected to recover billing', async () => {
	billing.enabled = true;
	billing.entitlement.mockResolvedValue(null);
	await expect(load(event('/contacts') as never)).rejects.toMatchObject({
		status: 303,
		location: '/billing'
	});
});
it('included member with entitlement can use CRM', async () => {
	billing.enabled = true;
	billing.entitlement.mockResolvedValue({ id: 'sub', status: 'active' });
	expect(await load(event('/contacts') as never)).toHaveProperty('user.id', 'buyer');
});
it('billing remains reachable without entitlement', async () => {
	billing.enabled = true;
	expect(await load(event('/billing') as never)).toHaveProperty('user.id', 'buyer');
	expect(billing.entitlement).not.toHaveBeenCalled();
});
it('billing outage fails closed with a recoverable status', async () => {
	billing.enabled = true;
	billing.entitlement.mockRejectedValue(new Error('offline'));
	await expect(load(event('/contacts') as never)).rejects.toMatchObject({ status: 503 });
});
it('anonymous users are sent to login', async () => {
	await expect(load(event('/contacts', null) as never)).rejects.toMatchObject({
		status: 303,
		location: '/login?next=%2Fcontacts'
	});
});

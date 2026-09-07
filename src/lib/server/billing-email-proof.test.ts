import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('$env/dynamic/private', () => ({ env: { BILLING_CLAIM_SECRET: 'test-shared-secret' } }));
vi.mock('$lib/server/hosted-billing.js', () => ({
	claimHostedSubscription: vi.fn(),
	hostedBillingAction: vi.fn(),
	hostedEntitlementForUser: vi.fn(),
	isHostedBillingEnabled: () => true
}));
import {
	challengeCookie,
	proofCookie,
	pkceVerifierHash,
	readEmailProof,
	signEmailProof
} from './billing-email-proof.js';
import { GET } from '../../routes/billing/email-callback/+server.js';
import { actions } from '../../routes/billing/+page.server.js';

function fixture() {
	const values = new Map<string, string>();
	const cookies = {
		get: (key: string) => values.get(key),
		getAll: () => [...values].map(([name, value]) => ({ name, value })),
		set: vi.fn((key: string, value: string) => values.set(key, value)),
		delete: vi.fn((key: string) => values.delete(key))
	};
	const user = { id: 'buyer', email: 'buyer@example.test' };
	const exchange = vi.fn(async () => ({ data: { user }, error: null }));
	const signInWithOtp = vi.fn(async () => {
		cookies.set('sb-project-auth-token-code-verifier', 'fresh-pkce-verifier');
		return { error: null };
	});
	const event = {
		cookies,
		url: new URL('https://app.headquarters-crm.com/billing/email-callback?code=email-code'),
		locals: {
			getValidatedSession: async () => ({ user, session: { access_token: 'access' } }),
			supabase: { auth: { signInWithOtp, exchangeCodeForSession: exchange } }
		}
	};
	return { event, cookies, values, user, exchange, signInWithOtp };
}

describe('billing recovery inbox proof', () => {
	beforeEach(() => vi.clearAllMocks());
	it('sends to the signed-in email and binds the callback to its PKCE verifier', async () => {
		const f = fixture();
		const response = await actions.emailRecovery(f.event as never);
		expect(response).toEqual({ emailSent: true });
		expect(f.signInWithOtp).toHaveBeenCalledWith({
			email: f.user.email,
			options: {
				shouldCreateUser: false,
				emailRedirectTo: 'https://app.headquarters-crm.com/billing/email-callback'
			}
		});
		const challenge = readEmailProof(f.cookies.get(challengeCookie));
		expect(challenge?.verifierHash).toBe(pkceVerifierHash(f.cookies.getAll()));
		await expect(GET(f.event as never)).rejects.toMatchObject({
			status: 303,
			location: '/billing?recover=email'
		});
		expect(f.exchange).toHaveBeenCalledWith('email-code');
		expect(readEmailProof(f.cookies.get(proofCookie))).toMatchObject({
			purpose: 'headquarters-email-recovery',
			userId: 'buyer',
			email: f.user.email
		});
		expect(f.cookies.get(challengeCookie)).toBeUndefined();
	});
	it('rejects callbacks without the challenge or after another login replaces PKCE', async () => {
		for (const replace of [false, true]) {
			const f = fixture();
			if (replace) {
				await actions.emailRecovery(f.event as never);
				f.cookies.set('sb-project-auth-token-code-verifier', 'different');
			}
			await expect(GET(f.event as never)).rejects.toMatchObject({
				location: '/billing?recovery_error=expired'
			});
			expect(f.exchange).not.toHaveBeenCalled();
			expect(f.cookies.get(proofCookie)).toBeUndefined();
		}
	});
	it('does not issue proof when the authenticated email changes', async () => {
		const f = fixture();
		await actions.emailRecovery(f.event as never);
		f.user.email = 'other@example.test';
		await expect(GET(f.event as never)).rejects.toMatchObject({
			location: '/billing?recovery_error=expired'
		});
		expect(f.cookies.get(proofCookie)).toBeUndefined();
	});
	it('rejects expired and tampered proofs', () => {
		const proof = signEmailProof({
			purpose: 'headquarters-email-recovery',
			userId: 'buyer',
			email: 'buyer@example.test',
			expiresAt: 1
		});
		expect(readEmailProof(proof)).toBeNull();
		expect(readEmailProof(proof + 'tampered')).toBeNull();
		expect(pkceVerifierHash([])).toBeNull();
	});
});

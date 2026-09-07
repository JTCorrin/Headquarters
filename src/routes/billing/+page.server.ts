import { fail, redirect } from '@sveltejs/kit';
import {
	claimHostedSubscription,
	hostedBillingAction,
	hostedEntitlementForUser,
	isHostedBillingEnabled
} from '$lib/server/hosted-billing.js';
import type { Actions, PageServerLoad } from './$types.js';
import {
	challengeCookie,
	proofCookie,
	pkceVerifierHash,
	readEmailProof,
	signEmailProof
} from '$lib/server/billing-email-proof.js';

export const load: PageServerLoad = async ({ locals, url, cookies }) => {
	if (!isHostedBillingEnabled()) redirect(303, '/');
	const { session, user } = await locals.getValidatedSession();
	if (!session || !user)
		redirect(303, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
	const { data: ownedOrganisations, error: ownedError } = await locals.supabase!.rpc(
		'hosted_owned_organisations'
	);
	if (ownedError) throw new Error('Could not load organisation billing options');
	const { data: billingAccounts, error: accountsError } =
		await locals.supabase!.rpc('hosted_billing_accounts');
	if (accountsError) throw new Error('Could not load subscriptions');
	return {
		billingAccounts: (billingAccounts ?? []) as { id: string; name: string; status: string }[],
		ownedOrganisations: (ownedOrganisations ?? []) as { id: string; name: string }[],
		entitlement: await hostedEntitlementForUser(user.id),
		claim: url.searchParams.get('claim') ?? '',
		email: user.email ?? '',
		emailRecovery: readEmailProof(cookies.get(proofCookie))?.userId === user.id,
		recoveryError: url.searchParams.has('recovery_error'),
		sessionId: url.searchParams.get('session_id') ?? ''
	};
};
export const actions: Actions = {
	emailRecovery: async ({ locals, url, cookies }) => {
		if (!isHostedBillingEnabled()) return fail(404, { error: 'Hosted billing is not enabled.' });
		const { session, user } = await locals.getValidatedSession();
		if (!session || !user?.email || !locals.supabase)
			return fail(401, { error: 'Please sign in again.' });
		const callback = new URL('/billing/email-callback', url.origin);
		const { error } = await locals.supabase.auth.signInWithOtp({
			email: user.email,
			options: { shouldCreateUser: false, emailRedirectTo: callback.toString() }
		});
		if (error)
			return fail(429, { error: 'Could not send the recovery link. Wait a minute and try again.' });
		const verifierHash = pkceVerifierHash(cookies.getAll());
		if (!verifierHash) return fail(503, { error: 'Email recovery could not start. Please retry.' });
		cookies.set(
			challengeCookie,
			signEmailProof({
				purpose: 'headquarters-email-challenge',
				userId: user.id,
				email: user.email,
				verifierHash,
				expiresAt: Math.floor(Date.now() / 1000) + 3600
			}),
			{
				path: '/billing',
				httpOnly: true,
				sameSite: 'lax',
				secure: url.protocol === 'https:',
				maxAge: 3600
			}
		);
		cookies.delete(proofCookie, { path: '/billing' });
		return { emailSent: true };
	},
	completeEmailRecovery: async ({ locals, cookies }) => {
		if (!isHostedBillingEnabled()) return fail(404, { error: 'Hosted billing is not enabled.' });
		const { session } = await locals.getValidatedSession();
		if (!session) return fail(401, { error: 'Please sign in again.' });
		try {
			const response = await hostedBillingAction('recover-email', session.access_token, {
				recovery_proof: cookies.get(proofCookie) ?? ''
			});
			const result = await response.json();
			if (!response.ok)
				return fail(response.status, { error: result.error ?? 'Could not recover payment.' });
		} catch {
			return fail(502, { error: 'Billing is temporarily unavailable. Please retry.' });
		}
		cookies.delete(proofCookie, { path: '/billing' });
		redirect(303, '/');
	},
	attach: async ({ locals, request }) => {
		const { session } = await locals.getValidatedSession();
		if (!session || !locals.supabase) return fail(401, { error: 'Please sign in again.' });
		const input = await request.formData();
		const { error } = await locals.supabase.rpc('attach_hosted_subscription', {
			p_org_id: String(input.get('org_id') ?? '')
		});
		if (error) return fail(400, { error: error.message });
		redirect(303, '/');
	},
	claim: async ({ locals, request }) => {
		const { session, user } = await locals.getValidatedSession();
		if (!session || !user?.email) return fail(401, { error: 'Please sign in again.' });
		const input = await request.formData();
		try {
			const result = await claimHostedSubscription({
				token: String(input.get('token') ?? ''),
				userId: user.id,
				email: user.email,
				accessToken: session.access_token
			});
			if (!result.ok)
				return fail(result.status ?? 400, { error: result.error ?? 'Could not link payment.' });
		} catch {
			return fail(502, { error: 'Billing is temporarily unavailable. Please retry.' });
		}
		redirect(303, '/');
	},
	recover: async ({ locals, request }) => {
		const { session } = await locals.getValidatedSession();
		if (!session) return fail(401, { error: 'Please sign in again.' });
		const input = await request.formData();
		try {
			const res = await hostedBillingAction('recover', session.access_token, {
				session_id: String(input.get('session_id') ?? '')
			});
			const data = await res.json();
			if (!res.ok) return fail(res.status, { error: data.error ?? 'Could not recover payment.' });
		} catch {
			return fail(502, { error: 'Billing is temporarily unavailable. Please retry.' });
		}
		redirect(303, '/');
	},
	portal: async ({ locals, request }) => {
		const { session } = await locals.getValidatedSession();
		if (!session) return fail(401, { error: 'Please sign in again.' });
		let url: string;
		try {
			const input = await request.formData();
			const res = await hostedBillingAction('portal', session.access_token, {
				subscription_id: String(input.get('subscription_id') ?? '')
			});
			const data = await res.json();
			if (!res.ok) return fail(res.status, { error: data.error ?? 'Could not open billing.' });
			url = data.url;
			if (new URL(url).origin !== 'https://billing.stripe.com')
				throw new Error('Invalid portal URL');
		} catch {
			return fail(502, { error: 'Billing is temporarily unavailable. Please retry.' });
		}
		redirect(303, url);
	}
};

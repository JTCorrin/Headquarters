import { fail, redirect } from '@sveltejs/kit';
import {
	claimHostedSubscription,
	hostedBillingAction,
	hostedEntitlementForUser,
	isHostedBillingEnabled
} from '$lib/server/hosted-billing.js';
import type { Actions, PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ locals, url }) => {
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
		sessionId: url.searchParams.get('session_id') ?? ''
	};
};
export const actions: Actions = {
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
